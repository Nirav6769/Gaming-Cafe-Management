-- Reservation conflicts
SELECT pc_id, start_time, end_time, status
FROM public.reservations
ORDER BY pc_id, start_time;

-- PC status against active maintenance and sessions
SELECT p.pc_id,p.pc_name,p.status,
  EXISTS(SELECT 1 FROM maintenance_records m WHERE m.pc_id=p.pc_id AND NOT m.resolved) AS has_open_maintenance,
  EXISTS(SELECT 1 FROM gaming_sessions s WHERE s.pc_id=p.pc_id AND s.end_time IS NULL) AS has_active_session
FROM gaming_pcs p ORDER BY p.pc_id;

-- Billing audit: snapshot rate x elapsed hours, rounded to 2 decimals
SELECT session_id,pc_id,hourly_rate_snapshot,start_time,end_time,total_cost
FROM gaming_sessions WHERE end_time IS NOT NULL ORDER BY session_id DESC;

-- Games played per session
SELECT sg.session_id,g.title,sg.duration_minutes,sg.added_at
FROM session_games sg JOIN games g USING(game_id)
ORDER BY sg.session_id,sg.added_at;

-- Open maintenance
SELECT maintenance_id,pc_id,maintenance_date,issue_description
FROM maintenance_records WHERE resolved=FALSE ORDER BY maintenance_date;
