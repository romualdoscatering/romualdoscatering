// Romualdo's staff app · connection to the Supabase project.
// The publishable key is meant to be public: it can only do what the database's security rules allow.
// Never put the service_role key or the database password here.
window.ROM_SUPABASE = {
  url: 'https://skqmlqujmjkzmiykkand.supabase.co',
  key: 'sb_publishable_FWjts74xJz3wuGA0bhMXfQ_5iQhckcf'
};
// Romualdo's contact details printed at the foot of event sheets and other PDFs. Change them here only.
window.ROM_CONTACT = {
  name: "Romualdo's Catering Services",
  address: '13 Juna Avenue, Juna Subdivision, Davao City',
  phone: '0945 542 5300',
  email: 'romualdoscatering@gmail.com',
  web: 'romualdos.ph'
};

// The phone-notification / drive-time Edge Function: the last part of its URL in Supabase → Edge Functions.
window.ROM_PUSH_FN = 'clever-service';
