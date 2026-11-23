import asyncio, re
from playwright.async_api import async_playwright
U='http://localhost:8899/app/'
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    ctx=await b.new_context(viewport={'width':1200,'height':900}); pg=await ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
    await pg.route('**/fonts.googleapis.com/**',lambda r:r.abort())
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    async def wait(): await pg.wait_for_timeout(700)
    async def toast(): return (await pg.inner_text('#toast')).strip()
    async def login(u):
      await pg.goto(U); await wait()
      if await pg.locator('[data-act=logout]').count(): await pg.click('[data-act=logout]'); await wait()
      await pg.fill('[name=login]',u); await pg.fill('[name=password]','x'); await pg.click('#loginForm button'); await pg.wait_for_timeout(1500)
    async def go(h): await pg.evaluate(f"location.hash='{h}'"); await pg.wait_for_timeout(1200)
    # 1 coordinator
    await login('coord'); print('1 home:', (await pg.inner_text('#main'))[:120].replace('\n',' | '))
    await go('#/c/event-new')
    await pg.fill('[name=title]','Santos Wedding'); await pg.select_option('[name=event_type]','Wedding'); await pg.fill('[name=event_date]','2026-12-20')
    await pg.fill('[name=serve_time]','18:00'); await pg.fill('[name=pax]','100'); await pg.fill('[name=venue]','Waterfront'); await pg.fill('[name=contract_price]','85000'); await pg.fill('[name=client_name]','Ana Santos')
    await pg.click('form[data-form=newEvent] button.pri'); await pg.wait_for_timeout(1500); print('  created:', await toast())
    evurl=pg.url
    for c,d in [('Main','Chicken Teriyaki'),('Main','beef steak'),('Pasta / noodles','Silky Sotanghon'),('Rice','Plain Rice'),('Drinks','softdrinks and iced tea'),('Dessert','Buko Pandan'),('Main','Lechon Belly Roll with Liver Sauce')]:
      await pg.select_option('form[data-form=addMenu] [name=course]',c); await pg.fill('form[data-form=addMenu] [name=dish]',d); await pg.click('form[data-form=addMenu] button'); await pg.wait_for_timeout(1300)
    print('  menu:', (await pg.inner_text('section.card >> nth=0'))[:400].replace('\n',' | '))
    await pg.click('[data-act=genPR]'); await pg.wait_for_timeout(1500); print('  generate (drafts):', await toast())
    await pg.screenshot(path='/home/claude/apptest/s1_event_coord.png', full_page=True)
    # 2 chef verifies recipes + adds off-menu ingredient
    await login('chef')
    for d in ['Chicken Teriyaki','Bistek Tagalog','Silky Sotanghon','Plain Rice','Assorted Soft Drinks','House Blend Iced Tea','Buko Pandan']:
      did=await pg.evaluate(f"fetch('/__api',{{method:'POST',body:JSON.stringify({{op:'select',table:'dishes',uid:'00000000-0000-0000-0000-0000000000a3',opts:{{cols:'id',eq:{{name:{d!r}}}}}}})}}).then(r=>r.json()).then(j=>j.data[0].id)")
      await go('#/c/recipe/'+did); await pg.click('[data-act=verify]'); await pg.wait_for_timeout(1500)
    print('2 chef verified:', await toast())
    await pg.screenshot(path='/home/claude/apptest/s2_recipe.png', full_page=True)
    await pg.goto(evurl); await pg.wait_for_timeout(1500)
    await pg.fill('form[data-form=addExtra] [name=item]','Beef brisket'); await pg.fill('form[data-form=addExtra] [name=qty]','3'); await pg.fill('form[data-form=addExtra] [name=note]','Lechon belly roll'); await pg.click('form[data-form=addExtra] button'); await pg.wait_for_timeout(1300)
    print('  extra needs:', (await pg.inner_text('section.card >> nth=1'))[:200].replace('\n',' | '))
    # 3 coordinator generates + submits
    await login('coord'); await pg.goto(evurl); await pg.wait_for_timeout(1500)
    await pg.click('[data-act=genPR]'); await pg.wait_for_timeout(1800); print('3 generate:', await toast(), '| at', pg.url.split('#')[1])
    rows=await pg.locator('form.card tbody tr').count(); print('  PR lines:', rows)
    await pg.click('[data-act=submitPR]'); await pg.wait_for_timeout(1500); print('  submit:', await toast())
    prurl=pg.url
    # 4 manager approves, trims soft drinks
    await login('mgr'); await go('#/c/requests'); print('4 manager list:', (await pg.inner_text('.list'))[:160].replace('\n',' | '))
    await pg.goto(prurl); await pg.wait_for_timeout(1500)
    sd=pg.locator('tr', has_text='Soft drinks').locator('input[name^=a_]'); await sd.fill('150')
    await pg.fill('form[data-form=approvePR] [name=note]','Buy at Agdao'); await pg.click('form[data-form=approvePR] button.pri'); await pg.wait_for_timeout(1500); print('  approve:', await toast())
    # 5 buyer orders chicken + beef only
    await login('buyer'); await pg.goto(prurl); await pg.wait_for_timeout(1500)
    boxes=pg.locator('input[type=checkbox][name^=o_]'); n=await boxes.count()
    for i in range(n):
      row=(await pg.locator('input[type=checkbox][name^=o_]').nth(i).locator('xpath=ancestor::tr').inner_text())
      if not any(k in row for k in ['Chicken thigh','Beef sirloin','Beef brisket']): await boxes.nth(i).uncheck()
    await pg.fill('#orderForm [name=supplier]','Agdao market — stall 12'); await pg.click('#orderForm button.pri'); await pg.wait_for_timeout(1500); print('5 order:', await toast())
    await pg.screenshot(path='/home/claude/apptest/s5_pr_buyer.png', full_page=True)
    # 6 storekeeper receives (chicken 0.5 short), issues to event, counts
    await login('store'); await go('#/c/orders'); print('6 orders:', (await pg.inner_text('.list'))[:140].replace('\n',' | '))
    await pg.click('.list .li'); await pg.wait_for_timeout(1500)
    for r in await pg.locator('form[data-form=receive] tbody tr').all():
      t=await r.inner_text(); q=r.locator('input[name^=q_]'); c=r.locator('input[name^=c_]')
      if 'Chicken' in t: await q.fill(str(float(await q.input_value())-0.5)); await c.fill('235')
      elif 'sirloin' in t: await c.fill('520')
      else: await c.fill('480')
    await pg.fill('[name=or_no]','OR-5531'); await pg.click('form[data-form=receive] button.pri'); await pg.wait_for_timeout(1800); print('  receive:', await toast())
    print('  receipts:', (await pg.inner_text('section.card')).replace('\n',' | ')[:200])
    await pg.screenshot(path='/home/claude/apptest/s6_receive.png', full_page=True)
    await pg.goto(evurl); await pg.wait_for_timeout(1700)
    await pg.fill('form[data-form=issue] [name=received_by]','Carlo Chef'); await pg.click('form[data-form=issue] button.pri'); await pg.wait_for_timeout(1700); print('  issue:', await toast())
    print('  costing:', (await pg.locator('section.card', has_text='Costing').inner_text()).replace('\n',' | ')[:220])
    await go('#/c/stock'); await pg.click('[data-act=startCount]'); await pg.wait_for_timeout(1500)
    await pg.fill('[name=witness]','Mona'); 
    inp=pg.locator('.count-row', has_text='Chicken thigh fillet').locator('input'); await inp.fill('0')
    await pg.click('[data-act=postCount]'); await pg.wait_for_timeout(1800); print('  count:', await toast())
    # 7 owner sets up newbie
    await login('owner@test.ph'); await go('#/people'); print('7 people:', (await pg.inner_text('.list'))[-160:].replace('\n',' | '))
    await pg.click('.li:has-text("newbie")'); await pg.wait_for_timeout(1300)
    await pg.fill('form[data-form=savePerson] [name=full_name]','Nina New'); await pg.check('[name=r_catering_staff]'); await pg.click('form[data-form=savePerson] button.pri'); await pg.wait_for_timeout(1500); print('  save person:', await toast())
    await login('newbie'); print('  newbie home:', (await pg.inner_text('#main'))[:80].replace('\n',' | '), '| new event btn:', await pg.locator('a[href="#/c/event-new"]').count())
    # 8 restaurant staff
    await login('resto'); print('8 resto home:', (await pg.inner_text('#main'))[:120].replace('\n',' | '))
    await go('#/c/events/all'); print('  resto catering events:', (await pg.inner_text('#main'))[-60:].replace('\n',' | '))
    # mobile
    m=await b.new_page(viewport={'width':390,'height':844}); await m.route('**/fonts.googleapis.com/**',lambda r:r.abort())
    await m.goto(U); await m.wait_for_timeout(800); await m.fill('[name=login]','coord'); await m.fill('[name=password]','x'); await m.click('#loginForm button'); await m.wait_for_timeout(1500)
    await m.goto(evurl); await m.wait_for_timeout(1800); await m.screenshot(path='/home/claude/apptest/s9_mobile_event.png', full_page=True)
    print('ERRORS', errs); await b.close()
asyncio.run(main())
