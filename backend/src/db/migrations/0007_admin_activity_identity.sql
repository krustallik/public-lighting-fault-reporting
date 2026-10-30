ALTER TABLE admin_activity_logs
  ADD COLUMN actor_username_snapshot VARCHAR(100);

UPDATE admin_activity_logs activity
   SET actor_username_snapshot = admins.username
  FROM admins
 WHERE activity.admin_id = admins.id
   AND activity.actor_username_snapshot IS NULL;

CREATE INDEX admin_activity_created_id_idx
  ON admin_activity_logs (created_at DESC, id DESC);
