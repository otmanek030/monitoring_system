-- =============================================================================
-- PHOSWATCH - Seed data
-- Realistic OCP Benguerir phosphate washing/flotation plant bootstrap
--
-- Executes AFTER init.sql. Idempotent (uses ON CONFLICT ... DO NOTHING).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Plants & Areas
-- -----------------------------------------------------------------------------
INSERT INTO plants (code, name, location, commissioned_on) VALUES
  ('BEN-WF1', 'Benguerir Washing & Flotation Plant 1', 'Benguerir, Morocco', '2013-06-01')
ON CONFLICT (code) DO NOTHING;

INSERT INTO areas (plant_id, code, name, description, criticality) VALUES
  (1, '230A', 'Primary Screening',        'Reception, coarse screening',                4),
  (1, '300',  'Common Utilities',         'Compressed air, water, power distribution',  3),
  (1, '310A', 'Washing Line A',           'Scrubbers, trommels, washing drums',         5),
  (1, '320A', 'Flotation Line A',         'Conditioning tanks, flotation cells',        5),
  (1, '330A', 'Dewatering Line A',        'Thickeners, filters, dewatering cyclones',   4),
  (1, '340G', 'Tailings Pumping',         'Slurry pumps, pipelines, tailings',          3),
  (1, '410A', 'Dry Product Handling',     'Belt conveyors, stacker, storage',           4)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Equipment types (ISA-5.1 inspired)
-- -----------------------------------------------------------------------------
INSERT INTO equipment_types (code, name, category, description) VALUES
  ('VP',   'Vertical Pump',       'pump',     'Centrifugal slurry/water pump'),
  ('RP',   'Reciprocating Pump',  'pump',     'Piston/plunger pump'),
  ('SP',   'Slurry Pump',         'pump',     'Heavy-duty slurry pump'),
  ('AG',   'Agitator',            'agitator', 'Tank agitator / mixer'),
  ('CY',   'Hydrocyclone',        'cyclone',  'Hydrocyclone separator'),
  ('FY',   'Flotation Cell',      'flotation','Flotation cell / bank'),
  ('LY',   'Filter',              'filter',   'Vacuum or pressure filter'),
  ('XV',   'On/Off Valve',        'valve',    'Isolation valve'),
  ('MOT',  'Electric Motor',      'motor',    'Electric drive motor'),
  ('CONV', 'Belt Conveyor',       'conveyor', 'Belt conveyor'),
  ('STKR', 'Stacker',             'stacker',  'Radial stacker')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Equipment  (realistic tag scheme: AREA_TYPE_TAG)
-- -----------------------------------------------------------------------------
INSERT INTO equipment
  (area_id, type_id, tag_code, name, description, manufacturer, model,
   criticality, status, expected_life_hours, runtime_hours)
VALUES
  ((SELECT area_id FROM areas WHERE code='310A'),
   (SELECT type_id FROM equipment_types WHERE code='VP'),
   '310A_VP_01S',  'Feed Pump 01S (Line A)',
   'Centrifugal pump feeding scrubber 01',
   'KSB', 'Omega-200',  5, 'running', 60000, 28400),

  ((SELECT area_id FROM areas WHERE code='310A'),
   (SELECT type_id FROM equipment_types WHERE code='AG'),
   '310A_AG_2410', 'Washing Drum Agitator 2410',
   'Agitator keeping pulp homogeneous',
   'Metso', 'MixPro-75', 4, 'running', 50000, 17200),

  ((SELECT area_id FROM areas WHERE code='320A'),
   (SELECT type_id FROM equipment_types WHERE code='FY'),
   '320A_FY_01',   'Flotation Cell Bank 01',
   'Rougher flotation bank - 6 cells',
   'FLSmidth', 'WEMCO-SmartCell', 5, 'running', 80000, 34110),

  ((SELECT area_id FROM areas WHERE code='320A'),
   (SELECT type_id FROM equipment_types WHERE code='SP'),
   '320A_SP_07',   'Slurry Pump 07',
   'Inter-cell slurry pump',
   'Warman', 'AH-200',  4, 'running', 50000, 22030),

  ((SELECT area_id FROM areas WHERE code='330A'),
   (SELECT type_id FROM equipment_types WHERE code='CY'),
   '330A_CY_03',   'Dewatering Cyclone 03',
   'Product dewatering hydrocyclone',
   'Krebs', 'gMAX-15',  3, 'running', 100000, 41200),

  ((SELECT area_id FROM areas WHERE code='340G'),
   (SELECT type_id FROM equipment_types WHERE code='SP'),
   '340G_SP_12',   'Tailings Slurry Pump 12',
   'Heavy-duty tailings pump',
   'Warman', 'AHF-400', 3, 'running', 45000, 39900),

  ((SELECT area_id FROM areas WHERE code='410A'),
   (SELECT type_id FROM equipment_types WHERE code='CONV'),
   '410A_CONV_B5', 'Belt Conveyor B5',
   'Main outbound conveyor',
   'Contitech', 'ST-2500', 4, 'running', 70000, 51020),

  ((SELECT area_id FROM areas WHERE code='410A'),
   (SELECT type_id FROM equipment_types WHERE code='STKR'),
   '410A_STKR_01', 'Radial Stacker 01',
   'Product stockpile stacker',
   'ThyssenKrupp', 'RS-30', 4, 'idle', 80000, 48800)
ON CONFLICT (tag_code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Sensors  (vibration, bearing temps, winding temps, pressure, flow, current, speed, level)
-- -----------------------------------------------------------------------------
-- Pump 310A_VP_01S: 2 vibrations (DE/NDE), 5 temps, 1 pressure, 1 flow, 1 current
INSERT INTO sensors
  (equipment_id, tag_code, name, measurement, unit, opc_node_id,
   sampling_period_ms, range_min, range_max, warn_low, warn_high, alarm_low, alarm_high)
VALUES
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_VP_01S'),
   '310A_VI_01S_DE',  'Pump 01S DE Vibration',   'vibration',  'mm/s', 'ns=2;s=310A.VP_01S.VI_DE',  500,  0, 20, NULL, 4.5, NULL, 7.1),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_VP_01S'),
   '310A_VI_01S_NDE', 'Pump 01S NDE Vibration',  'vibration',  'mm/s', 'ns=2;s=310A.VP_01S.VI_NDE', 500,  0, 20, NULL, 4.5, NULL, 7.1),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_VP_01S'),
   '310A_TI_5301_D',  'Pump 01S Bearing Temp D', 'temperature','degC', 'ns=2;s=310A.VP_01S.TI_D',  1000, -10, 120, NULL, 75, NULL, 90),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_VP_01S'),
   '310A_TI_5301_E',  'Pump 01S Bearing Temp E', 'temperature','degC', 'ns=2;s=310A.VP_01S.TI_E',  1000, -10, 120, NULL, 75, NULL, 90),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_VP_01S'),
   '310A_TI_5301_F',  'Pump 01S Winding Temp F', 'temperature','degC', 'ns=2;s=310A.VP_01S.TI_F',  1000, -10, 160, NULL, 110, NULL, 130),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_VP_01S'),
   '310A_TI_5301_G',  'Pump 01S Winding Temp G', 'temperature','degC', 'ns=2;s=310A.VP_01S.TI_G',  1000, -10, 160, NULL, 110, NULL, 130),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_VP_01S'),
   '310A_TI_5301_H',  'Pump 01S Winding Temp H', 'temperature','degC', 'ns=2;s=310A.VP_01S.TI_H',  1000, -10, 160, NULL, 110, NULL, 130),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_VP_01S'),
   '310A_PI_01S',     'Pump 01S Discharge Press','pressure',   'bar',  'ns=2;s=310A.VP_01S.PI',    1000,  0, 16, 0.8, 10.5, 0.3, 12),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_VP_01S'),
   '310A_FI_01S',     'Pump 01S Flow',           'flow',       'm3/h', 'ns=2;s=310A.VP_01S.FI',    1000,  0, 600, 200, 560, 120, 580),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_VP_01S'),
   '310A_II_01S',     'Pump 01S Motor Current',  'current',    'A',    'ns=2;s=310A.VP_01S.II',    1000,  0, 500, NULL, 380, NULL, 430);

-- Agitator 310A_AG_2410: 1 vibration, 2 temps, 1 current, 1 speed
INSERT INTO sensors
  (equipment_id, tag_code, name, measurement, unit, opc_node_id,
   sampling_period_ms, range_min, range_max, warn_low, warn_high, alarm_low, alarm_high)
VALUES
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_AG_2410'),
   '310A_VI_2410',    'Agitator 2410 Vibration', 'vibration', 'mm/s', 'ns=2;s=310A.AG_2410.VI',  500, 0, 20, NULL, 5.0, NULL, 7.5),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_AG_2410'),
   '310A_TI_2410_B',  'Agitator 2410 Bearing',   'temperature','degC','ns=2;s=310A.AG_2410.TI_B',1000,-10,120,NULL, 80, NULL, 95),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_AG_2410'),
   '310A_TI_2410_W',  'Agitator 2410 Winding',   'temperature','degC','ns=2;s=310A.AG_2410.TI_W',1000,-10,160,NULL,115, NULL,135),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_AG_2410'),
   '310A_II_2410',    'Agitator 2410 Current',   'current',   'A',    'ns=2;s=310A.AG_2410.II',  1000,  0,300, NULL,220, NULL,260),
  ((SELECT equipment_id FROM equipment WHERE tag_code='310A_AG_2410'),
   '310A_SI_2410',    'Agitator 2410 Speed',     'speed',     'rpm',  'ns=2;s=310A.AG_2410.SI',  1000,  0,1800, 600,1600, 400,1720);

-- Flotation cell 320A_FY_01: 2 levels, 1 flow (air), 1 flow (reagent), pH
INSERT INTO sensors
  (equipment_id, tag_code, name, measurement, unit, opc_node_id,
   sampling_period_ms, range_min, range_max, warn_low, warn_high, alarm_low, alarm_high)
VALUES
  ((SELECT equipment_id FROM equipment WHERE tag_code='320A_FY_01'),
   '320A_LI_01_A',    'Cell 01 Froth Level A',   'level',   '%',    'ns=2;s=320A.FY_01.LI_A',  1000,  0,100, 30, 80, 15, 95),
  ((SELECT equipment_id FROM equipment WHERE tag_code='320A_FY_01'),
   '320A_LI_01_B',    'Cell 01 Pulp Level B',    'level',   '%',    'ns=2;s=320A.FY_01.LI_B',  1000,  0,100, 35, 85, 20, 95),
  ((SELECT equipment_id FROM equipment WHERE tag_code='320A_FY_01'),
   '320A_FI_01_AIR',  'Cell 01 Air Flow',        'flow',    'Nm3/h','ns=2;s=320A.FY_01.FI_AIR',1000,  0,3000, 800,2600, 500,2900),
  ((SELECT equipment_id FROM equipment WHERE tag_code='320A_FY_01'),
   '320A_FI_01_REG',  'Cell 01 Reagent Flow',    'flow',    'L/h',  'ns=2;s=320A.FY_01.FI_REG',1000,  0, 200, 20, 180, 10, 195),
  ((SELECT equipment_id FROM equipment WHERE tag_code='320A_FY_01'),
   '320A_QI_01_PH',   'Cell 01 pH',              'ph',      'pH',   'ns=2;s=320A.FY_01.QI_PH', 2000,  0,  14, 8.0, 10.5, 7.5, 11.0);

-- Slurry pump 320A_SP_07: vibration + temps + pressure + flow + current
INSERT INTO sensors
  (equipment_id, tag_code, name, measurement, unit, opc_node_id,
   sampling_period_ms, range_min, range_max, warn_low, warn_high, alarm_low, alarm_high)
VALUES
  ((SELECT equipment_id FROM equipment WHERE tag_code='320A_SP_07'),
   '320A_VI_SP_07',   'Pump 07 Vibration',       'vibration',  'mm/s', 'ns=2;s=320A.SP_07.VI',  500, 0, 20, NULL, 4.5, NULL, 7.1),
  ((SELECT equipment_id FROM equipment WHERE tag_code='320A_SP_07'),
   '320A_TI_SP_07_B', 'Pump 07 Bearing Temp',    'temperature','degC', 'ns=2;s=320A.SP_07.TI_B',1000,-10,120,NULL, 75, NULL, 90),
  ((SELECT equipment_id FROM equipment WHERE tag_code='320A_SP_07'),
   '320A_PI_SP_07',   'Pump 07 Discharge Press', 'pressure',   'bar',  'ns=2;s=320A.SP_07.PI',  1000, 0,  16, 0.8,10.5, 0.3, 12),
  ((SELECT equipment_id FROM equipment WHERE tag_code='320A_SP_07'),
   '320A_II_SP_07',   'Pump 07 Motor Current',   'current',    'A',    'ns=2;s=320A.SP_07.II',  1000, 0, 500,NULL,360,NULL,420);

-- Cyclone 330A_CY_03: feed pressure, UF density, OF density
INSERT INTO sensors
  (equipment_id, tag_code, name, measurement, unit, opc_node_id,
   sampling_period_ms, range_min, range_max, warn_low, warn_high, alarm_low, alarm_high)
VALUES
  ((SELECT equipment_id FROM equipment WHERE tag_code='330A_CY_03'),
   '330A_PI_CY_03',   'Cyclone 03 Feed Press',   'pressure', 'bar',  'ns=2;s=330A.CY_03.PI',  1000, 0, 6, 0.5, 3.5, 0.3, 4.5),
  ((SELECT equipment_id FROM equipment WHERE tag_code='330A_CY_03'),
   '330A_DI_CY_03_UF','Cyclone 03 UF Density',   'density',  'kg/m3','ns=2;s=330A.CY_03.DI_UF',2000, 1000, 2200, 1400, 2000, 1300, 2100),
  ((SELECT equipment_id FROM equipment WHERE tag_code='330A_CY_03'),
   '330A_DI_CY_03_OF','Cyclone 03 OF Density',   'density',  'kg/m3','ns=2;s=330A.CY_03.DI_OF',2000, 1000, 2000, 1050, 1400, 1000, 1500);

-- Tailings pump 340G_SP_12: vibration + temps + current
INSERT INTO sensors
  (equipment_id, tag_code, name, measurement, unit, opc_node_id,
   sampling_period_ms, range_min, range_max, warn_low, warn_high, alarm_low, alarm_high)
VALUES
  ((SELECT equipment_id FROM equipment WHERE tag_code='340G_SP_12'),
   '340G_VI_SP_12',   'Pump 12 Vibration',       'vibration',  'mm/s', 'ns=2;s=340G.SP_12.VI',  500, 0, 20, NULL, 4.5, NULL, 7.1),
  ((SELECT equipment_id FROM equipment WHERE tag_code='340G_SP_12'),
   '340G_TI_SP_12_B', 'Pump 12 Bearing Temp',    'temperature','degC', 'ns=2;s=340G.SP_12.TI_B',1000,-10,120,NULL, 78, NULL, 92),
  ((SELECT equipment_id FROM equipment WHERE tag_code='340G_SP_12'),
   '340G_II_SP_12',   'Pump 12 Motor Current',   'current',    'A',    'ns=2;s=340G.SP_12.II',  1000,  0, 600,NULL,460,NULL,520);

-- Conveyor 410A_CONV_B5: belt speed, motor current, motor temp, belt tension
INSERT INTO sensors
  (equipment_id, tag_code, name, measurement, unit, opc_node_id,
   sampling_period_ms, range_min, range_max, warn_low, warn_high, alarm_low, alarm_high)
VALUES
  ((SELECT equipment_id FROM equipment WHERE tag_code='410A_CONV_B5'),
   '410A_SI_B5',      'Conveyor B5 Belt Speed',  'speed',     'm/s',  'ns=2;s=410A.CONV_B5.SI',  1000, 0, 5, 1.0, 4.5, 0.5, 4.8),
  ((SELECT equipment_id FROM equipment WHERE tag_code='410A_CONV_B5'),
   '410A_II_B5',      'Conveyor B5 Current',     'current',   'A',    'ns=2;s=410A.CONV_B5.II',  1000, 0, 800, NULL, 620, NULL, 720),
  ((SELECT equipment_id FROM equipment WHERE tag_code='410A_CONV_B5'),
   '410A_TI_B5_M',    'Conveyor B5 Motor Temp',  'temperature','degC','ns=2;s=410A.CONV_B5.TI_M',1000,-10,160,NULL, 115, NULL, 135),
  ((SELECT equipment_id FROM equipment WHERE tag_code='410A_CONV_B5'),
   '410A_WI_B5',      'Conveyor B5 Belt Tension','tension',   'kN',   'ns=2;s=410A.CONV_B5.WI',  1000, 0, 400, 50, 320, 20, 360);

-- Stacker 410A_STKR_01: position, speed, current
INSERT INTO sensors
  (equipment_id, tag_code, name, measurement, unit, opc_node_id,
   sampling_period_ms, range_min, range_max, warn_low, warn_high, alarm_low, alarm_high)
VALUES
  ((SELECT equipment_id FROM equipment WHERE tag_code='410A_STKR_01'),
   '410A_ZI_STKR',    'Stacker Position',        'position',  'deg',  'ns=2;s=410A.STKR_01.ZI',  1000,  -180, 180, -170, 170, -180, 180),
  ((SELECT equipment_id FROM equipment WHERE tag_code='410A_STKR_01'),
   '410A_II_STKR',    'Stacker Slew Current',    'current',   'A',    'ns=2;s=410A.STKR_01.II',  1000,  0, 200, NULL, 150, NULL, 180);


-- -----------------------------------------------------------------------------
-- Alarm definitions  (high-threshold rules for the main sensors)
-- -----------------------------------------------------------------------------
INSERT INTO alarm_definitions
  (sensor_id, code, condition_type, threshold, hysteresis, severity, priority, message_en, message_fr)
SELECT s.sensor_id, 'H1_WARNING', 'high', s.warn_high, 0.5, 'warning', 3,
       s.name || ' high warning', s.name || ' avertissement haut'
FROM sensors s WHERE s.warn_high IS NOT NULL
ON CONFLICT (sensor_id, code) DO NOTHING;

INSERT INTO alarm_definitions
  (sensor_id, code, condition_type, threshold, hysteresis, severity, priority, message_en, message_fr)
SELECT s.sensor_id, 'H2_ALARM', 'high', s.alarm_high, 0.5, 'fatal', 2,
       s.name || ' high alarm', s.name || ' alarme haute'
FROM sensors s WHERE s.alarm_high IS NOT NULL
ON CONFLICT (sensor_id, code) DO NOTHING;

INSERT INTO alarm_definitions
  (sensor_id, code, condition_type, threshold, hysteresis, severity, priority, message_en, message_fr)
SELECT s.sensor_id, 'L1_WARNING', 'low', s.warn_low, 0.5, 'warning', 3,
       s.name || ' low warning', s.name || ' avertissement bas'
FROM sensors s WHERE s.warn_low IS NOT NULL
ON CONFLICT (sensor_id, code) DO NOTHING;

INSERT INTO alarm_definitions
  (sensor_id, code, condition_type, threshold, hysteresis, severity, priority, message_en, message_fr)
SELECT s.sensor_id, 'L2_ALARM', 'low', s.alarm_low, 0.5, 'fatal', 2,
       s.name || ' low alarm', s.name || ' alarme basse'
FROM sensors s WHERE s.alarm_low IS NOT NULL
ON CONFLICT (sensor_id, code) DO NOTHING;


-- -----------------------------------------------------------------------------
-- Roles & Users
-- -----------------------------------------------------------------------------
INSERT INTO roles (code, name, description, permissions) VALUES
  ('admin',      'Administrator', 'Full access',
    '{"equipment":"*","alarms":"*","users":"*","reports":"*","predictions":"*","maintenance":"*"}'),
  ('supervisor', 'Supervisor',    'Plant supervisor',
    '{"equipment":"r","alarms":"rw","users":"r","reports":"rw","predictions":"r","maintenance":"rw"}'),
  ('technician', 'Technician',    'Maintenance technician',
    '{"equipment":"r","alarms":"rw","reports":"r","predictions":"r","maintenance":"rw"}'),
  ('operator',   'Operator',      'Control room operator',
    '{"equipment":"r","alarms":"rw","reports":"r","predictions":"r","maintenance":"r"}'),
  ('viewer',     'Viewer',        'Read-only viewer',
    '{"equipment":"r","alarms":"r","reports":"r","predictions":"r","maintenance":"r"}')
ON CONFLICT (code) DO NOTHING;

-- Default users.  Password for ALL seed users is: phoswatch123
-- bcrypt hash of "phoswatch123" ($2b$10$...)
INSERT INTO users (username, email, full_name, password_hash, role_id) VALUES
  ('admin',   'admin@phoswatch.local',      'System Administrator',
   '$2b$10$k2p/y2wE2dkf6mxkGcSz7uUSM1q1t95aHlKydHUiiAb2Wzt0dmQIS',
   (SELECT role_id FROM roles WHERE code='admin')),
  ('fahmi',   'fahmi@phoswatch.local',      'FAHMI Abderrahim',
   '$2b$10$k2p/y2wE2dkf6mxkGcSz7uUSM1q1t95aHlKydHUiiAb2Wzt0dmQIS',
   (SELECT role_id FROM roles WHERE code='supervisor')),
  ('othmane', 'othmane@phoswatch.local',    'EL BARNATY Othmane',
   '$2b$10$k2p/y2wE2dkf6mxkGcSz7uUSM1q1t95aHlKydHUiiAb2Wzt0dmQIS',
   (SELECT role_id FROM roles WHERE code='admin')),
  ('tech1',   'tech1@phoswatch.local',      'Technician 1',
   '$2b$10$k2p/y2wE2dkf6mxkGcSz7uUSM1q1t95aHlKydHUiiAb2Wzt0dmQIS',
   (SELECT role_id FROM roles WHERE code='technician')),
  ('op1',     'op1@phoswatch.local',        'Operator 1',
   '$2b$10$k2p/y2wE2dkf6mxkGcSz7uUSM1q1t95aHlKydHUiiAb2Wzt0dmQIS',
   (SELECT role_id FROM roles WHERE code='operator'))
ON CONFLICT (username) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Shifts (3x8)
-- -----------------------------------------------------------------------------
INSERT INTO shifts (code, name, start_time, end_time) VALUES
  ('MORNING',   'Morning Shift',   '06:00', '14:00'),
  ('AFTERNOON', 'Afternoon Shift', '14:00', '22:00'),
  ('NIGHT',     'Night Shift',     '22:00', '06:00')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- ML model registry entries (filled in at first training by ML service)
-- -----------------------------------------------------------------------------
INSERT INTO ml_models (name, model_type, version, algorithm, metrics, path, is_active) VALUES
  ('anomaly_iforest',   'anomaly',    'v0.1', 'IsolationForest',
   '{"contamination":0.02}'::jsonb, '/app/models/anomaly_iforest_v0.1.pkl', TRUE),
  ('predictive_xgb',    'predictive', 'v0.1', 'XGBoost',
   '{"horizon_days":7}'::jsonb,     '/app/models/predictive_xgb_v0.1.pkl', TRUE),
  ('rul_lstm',          'rul',        'v0.1', 'LSTM',
   '{"seq_len":50}'::jsonb,         '/app/models/rul_lstm_v0.1.pkl',       TRUE)
ON CONFLICT (name, version) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Example maintenance orders
-- -----------------------------------------------------------------------------
INSERT INTO maintenance_orders (equipment_id, order_type, priority, title, description, status, created_by, assigned_to, planned_start, planned_end)
SELECT e.equipment_id, 'preventive', 'normal',
       'Quarterly lubrication - ' || e.tag_code,
       'Scheduled bearing lubrication and visual inspection',
       'scheduled',
       (SELECT user_id FROM users WHERE username='admin'),
       (SELECT user_id FROM users WHERE username='tech1'),
       NOW() + INTERVAL '3 days',
       NOW() + INTERVAL '3 days 2 hours'
FROM equipment e
WHERE e.tag_code IN ('310A_VP_01S','320A_SP_07','340G_SP_12')
ON CONFLICT DO NOTHING;

-- End of seed
