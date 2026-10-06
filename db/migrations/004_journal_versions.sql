ALTER TABLE monthly_journal
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
