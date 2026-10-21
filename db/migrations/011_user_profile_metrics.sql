ALTER TABLE users
  ADD COLUMN age integer CHECK (age IS NULL OR age BETWEEN 13 AND 120),
  ADD COLUMN height_cm numeric(5,2) CHECK (height_cm IS NULL OR height_cm BETWEEN 50 AND 250),
  ADD COLUMN weight_kg numeric(6,2) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 500);
