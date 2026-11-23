"""Local test server for the staff app (test only, never deployed).
Serves the repo's static files and answers the app's data calls against the local PostgreSQL copy of the
Supabase schema, running each call as the logged-in user (role 'authenticated' + their id) so the real
row-level security rules apply — the same way Supabase's Data API does."""
import json, re, subprocess, sys, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

DB = os.environ.get('TESTDB', 'rom')
ROOT = sys.argv[1]
ID = re.compile(r'^[a-z_][a-z0-9_]*$')
_fn = {}

def ident(s):
    if not ID.match(s or ''): raise ValueError('bad identifier ' + str(s))
    return s

def lit(v):
    if v is None: return 'NULL'
    if isinstance(v, bool): return 'TRUE' if v else 'FALSE'
    if isinstance(v, (int, float)): return repr(v)
    if isinstance(v, str): return "'" + v.replace("'", "''") + "'"
    if isinstance(v, list) and all(not isinstance(x, (dict, list)) for x in v):
        return "'{" + ','.join('"' + str(x).replace('"', '\\"') + '"' for x in v) + "}'"
    return "'" + json.dumps(v).replace("'", "''") + "'"

def run(sql, uid):
    pre = f"set role authenticated; set request.jwt.claim.sub = '{uid}';" if uid else "set role anon;"
    p = subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', DB, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', pre + sql],
                       capture_output=True, text=True)
    if p.returncode != 0:
        m = re.search(r'ERROR:\s+(.*)', p.stderr)
        raise RuntimeError(m.group(1) if m else p.stderr.strip())
    out = p.stdout.strip()
    return json.loads(out) if out else None

def where(o):
    w = []
    for k, v in (o.get('eq') or {}).items(): w.append(f"{ident(k)} is null" if v is None else f"{ident(k)} = {lit(v)}")
    for k, v in (o.get('neq') or {}).items(): w.append(f"{ident(k)} <> {lit(v)}")
    for k, v in (o.get('in') or {}).items(): w.append(f"{ident(k)} in ({','.join(lit(x) for x in v) or 'NULL'})")
    for k, v in (o.get('gte') or {}).items(): w.append(f"{ident(k)} >= {lit(v)}")
    for k, v in (o.get('lte') or {}).items(): w.append(f"{ident(k)} <= {lit(v)}")
    return (' where ' + ' and '.join(w)) if w else ''

def handle(b):
    op, uid = b['op'], b.get('uid')
    if op == 'login':
        p = subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', DB, '-qAt', '-c', f"select id from auth.users where lower(email) = lower({lit(b['email'])})"], capture_output=True, text=True)
        if not p.stdout.strip(): raise RuntimeError('Invalid login credentials')
        return {'id': p.stdout.strip(), 'email': b['email']}
    if op == 'select':
        o = b.get('opts') or {}
        cols = '*' if (o.get('cols') or '*') == '*' else ','.join(ident(c.strip()) for c in o['cols'].split(','))
        order = ', '.join(f"{ident(k)} {'asc' if (len(x) < 2 or x[1] is not False) else 'desc'}" for x in (o.get('order') or []) for k in [x[0]])
        sql = f"select coalesce(json_agg(t), '[]'::json) from (select {cols} from {ident(b['table'])}{where(o)}{' order by ' + order if order else ''}{' limit ' + str(int(o['limit'])) if o.get('limit') else ''}) t"
        return run(sql, uid)
    if op in ('insert', 'upsert'):
        rows = b['rows']; cols = list(rows[0].keys())
        vals = ', '.join('(' + ', '.join(lit(r.get(c)) for c in cols) + ')' for r in rows)
        conflict = ''
        if op == 'upsert':
            keys = [ident(k.strip()) for k in b['onConflict'].split(',')]
            sets = ', '.join(f"{ident(c)} = excluded.{ident(c)}" for c in cols if c not in keys) or f"{keys[0]} = excluded.{keys[0]}"
            conflict = f" on conflict ({', '.join(keys)}) do update set {sets}"
        sql = f"with w as (insert into {ident(b['table'])} ({', '.join(ident(c) for c in cols)}) values {vals}{conflict} returning *) select coalesce(json_agg(w), '[]'::json) from w"
        return run(sql, uid)
    if op == 'update':
        sets = ', '.join(f"{ident(k)} = {lit(v)}" for k, v in b['patch'].items())
        rows = run(f"with w as (update {ident(b['table'])} set {sets}{where({'eq': b['eq']})} returning *) select coalesce(json_agg(w), '[]'::json) from w", uid)
        if not rows: raise RuntimeError('Not saved — you may not have permission, or it was changed by someone else.')
        return rows
    if op == 'remove':
        run(f"with w as (delete from {ident(b['table'])}{where({'eq': b['eq']})} returning 1) select count(*) from w", uid); return None
    if op == 'rpc':
        fn = ident(b['fn'])
        if fn not in _fn:
            p = subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', DB, '-qAt', '-c', f"select proretset::text || '|' || prorettype::regtype::text from pg_proc where proname = '{fn}' limit 1"], capture_output=True, text=True)
            _fn[fn] = p.stdout.strip().split('|')
        retset, rettype = _fn[fn]
        args = ', '.join(f"{ident(k)} => {lit(v)}" for k, v in (b.get('args') or {}).items() if v is not None)
        if retset == 'true': return run(f"select coalesce(json_agg(t), '[]'::json) from {fn}({args}) t", uid)
        if rettype == 'void': run(f"select 'null' from (select {fn}({args})) x", uid); return None
        return run(f"select to_json({fn}({args}))", uid)
    raise RuntimeError('unknown op')

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith('/app/config.js'):
            body = b"window.ROM_SUPABASE = {url: 'test', key: 'test'}; window.ROM_TEST_API = '/__api';"
            self.send_response(200); self.send_header('Content-Type', 'application/javascript'); self.end_headers(); self.wfile.write(body); return
        return super().do_GET()
    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        try: data, code = {'data': handle(b)}, 200
        except Exception as e: data, code = {'message': str(e)}, 400
        out = json.dumps(data).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)

ThreadingHTTPServer(('127.0.0.1', 8899), H).serve_forever()
