UPDATE notifications SET "isRead" = false
WHERE id IN ('f3a7dce3-b952-4759-98fd-ec6ce0a0c5bd', '1e8994a0-14d5-4580-b008-053b706ea43b');
SELECT id, type, "isRead", "resourceRef" FROM notifications WHERE id IN ('f3a7dce3-b952-4759-98fd-ec6ce0a0c5bd', '1e8994a0-14d5-4580-b008-053b706ea43b');
