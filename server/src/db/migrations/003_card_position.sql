ALTER TABLE cards ADD COLUMN position REAL DEFAULT 0;

UPDATE cards SET position = id WHERE position = 0;
