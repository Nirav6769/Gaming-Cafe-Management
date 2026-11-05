-- ============================================================================
-- GameHub: Academic DDL Demonstration Script (PESU Lab Rubric)
-- Author: Nikhil
-- Purpose: Demonstrates non-destructive CREATE, ALTER, and DROP DDL operations
--          within an isolated throw-away schema without altering application data.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ddl_demo;

-- 1. CREATE TABLE with constraints, default values, and foreign key
CREATE TABLE ddl_demo.demo_hardware_audit (
  audit_id SERIAL PRIMARY KEY,
  station_tag VARCHAR(50) NOT NULL,
  component_type VARCHAR(30) CHECK (component_type IN ('GPU', 'CPU', 'RAM', 'SSD', 'PERIPHERAL')),
  installed_on DATE DEFAULT CURRENT_DATE,
  health_score INTEGER CHECK (health_score BETWEEN 0 AND 100)
);

-- 2. ALTER TABLE: Add column, modify type, and create an index
ALTER TABLE ddl_demo.demo_hardware_audit
  ADD COLUMN serial_number VARCHAR(100) UNIQUE,
  ADD COLUMN notes TEXT;

ALTER TABLE ddl_demo.demo_hardware_audit
  ALTER COLUMN notes SET DEFAULT 'Standard hardware audit check';

CREATE INDEX idx_demo_hardware_station
  ON ddl_demo.demo_hardware_audit (station_tag, component_type);

-- 3. INSERT sample records to prove functional structure
INSERT INTO ddl_demo.demo_hardware_audit (station_tag, component_type, health_score, serial_number)
VALUES
  ('Alienware-01', 'GPU', 98, 'RTX4080-SN-001'),
  ('Alienware-01', 'CPU', 95, 'I9-14900K-SN-002');

-- Verify insertion
SELECT * FROM ddl_demo.demo_hardware_audit;

-- 4. DROP TABLE: Safely remove the demonstration table
DROP TABLE ddl_demo.demo_hardware_audit;

-- 5. Clean up the isolated demonstration schema
DROP SCHEMA ddl_demo CASCADE;
