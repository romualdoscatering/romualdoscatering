-- Run this one alone first: adds the Utility role (kitchen helper / utility: cleaning, equipment, non-food supplies).
alter type app_role add value if not exists 'utility';
