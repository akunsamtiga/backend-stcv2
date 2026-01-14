// backendv2/ecosystem.config.js
module.exports = {
  apps: [{
    name: 'binary-backend',
    script: './dist/main.js',
    
    instances: 1,
    exec_mode: 'fork',
    
    env_production: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--dns-result-order=ipv4first --max-old-space-size=768',
      PORT: 3000,
      TZ: 'Asia/Jakarta'
    },
    
    autorestart: true,
    watch: false,
    max_restarts: 15,
    min_uptime: '20s',
    restart_delay: 3000,
    
    max_memory_restart: '850M',
    
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    
    kill_timeout: 10000,
    wait_ready: false,
    listen_timeout: 5000,
    
    exp_backoff_restart_delay: 100,
    
    vizion: false,
    
    ignore_watch: [
      'node_modules',
      'logs',
      '*.log',
      '.git'
    ],
  }]
};
