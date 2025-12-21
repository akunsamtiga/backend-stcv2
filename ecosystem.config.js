module.exports = {
  apps: [{
    name: 'binary-backend',
    script: './dist/main.js',
    
    // Instance configuration
    instances: 1,  // Single instance (bisa dinaikkan jika butuh load balancing)
    exec_mode: 'fork',
    
    // Environment
    env_production: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--dns-result-order=ipv4first',
      PORT: 3000
    },
    
    // Restart configuration
    autorestart: true,
    watch: false,  // Set true jika ingin auto-restart on file change
    max_restarts: 10,
    min_uptime: '30s',
    restart_delay: 5000,
    
    // Memory management
    max_memory_restart: '300M',
    
    // Logging
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
    
    // Error handling
    exp_backoff_restart_delay: 100,
    
    // Cron restart (restart setiap hari jam 3 pagi)
    cron_restart: '0 3 * * *',
    
    // Process management
    vizion: false,
    
    // Post-deploy hooks
    post_update: ['npm install', 'npm run build']
  }]
};