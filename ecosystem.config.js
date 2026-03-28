module.exports = {
  apps: [
    {
      name: 'aitheros-backend',
      script: './backend/start.sh',
      cwd: '/opt/AitherOS',
      env: {
        NODE_ENV: 'production',
      },
      // Loads .env automatically via godotenv in main.go
      watch: false,
      max_memory_restart: '512M',
      error_file: '/opt/AitherOS/logs/backend-error.log',
      out_file: '/opt/AitherOS/logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'aitheros-frontend',
      script: 'npx',
      args: 'next start --port 3000',
      cwd: '/opt/AitherOS/frontend',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Loaded from frontend/.env.local — do NOT hardcode secrets here
      },
      watch: false,
      max_memory_restart: '512M',
      error_file: '/opt/AitherOS/logs/frontend-error.log',
      out_file: '/opt/AitherOS/logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
