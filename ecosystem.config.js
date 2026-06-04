/**
 * PM2 process config — runs API + Worker as separate processes on the same EC2.
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup   ← persist across reboots
 */
module.exports = {
  apps: [
    {
      name: 'medipulse-api',
      script: 'dist/main.js',
      instances: 2,               // 2 API processes per machine (cluster mode)
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/api-error.log',
      out_file:   'logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'medipulse-worker',
      script: 'dist/worker.js',
      instances: 1,               // single worker instance (BullMQ handles concurrency internally)
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '256M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/worker-error.log',
      out_file:   'logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
