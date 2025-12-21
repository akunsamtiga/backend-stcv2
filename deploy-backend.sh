#!/bin/bash

# ============================================
# BINARY OPTION BACKEND - VPS DEPLOYMENT
# ============================================
# Deploy to VPS without domain (IP only)
# ============================================

set -e  # Exit on error

echo "🚀 Binary Option Backend - VPS Deployment"
echo "=========================================="
echo ""

# ============================================
# CONFIGURATION - EDIT THESE
# ============================================
VPS_IP="YOUR_VPS_IP"              # e.g., 103.127.132.64
VPS_USER="stcautotrade"            # VPS username
VPS_PORT="22"                      # SSH port
DEPLOY_PATH="/home/stcautotrade/backend"  # Path di VPS
LOCAL_PROJECT="./backendv2"        # Local project path

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# FUNCTIONS
# ============================================

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

check_ssh_connection() {
    print_info "Checking SSH connection..."
    if ssh -p $VPS_PORT -o ConnectTimeout=5 $VPS_USER@$VPS_IP "echo 'SSH OK'" > /dev/null 2>&1; then
        print_success "SSH connection OK"
        return 0
    else
        print_error "Cannot connect to VPS via SSH"
        print_info "Please check:"
        echo "  - VPS IP: $VPS_IP"
        echo "  - Username: $VPS_USER"
        echo "  - SSH Key is configured"
        exit 1
    fi
}

# ============================================
# MAIN DEPLOYMENT
# ============================================

main() {
    echo ""
    print_info "Configuration:"
    echo "  VPS IP: $VPS_IP"
    echo "  User: $VPS_USER"
    echo "  Deploy Path: $DEPLOY_PATH"
    echo "  Local Project: $LOCAL_PROJECT"
    echo ""
    
    read -p "Continue with deployment? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Deployment cancelled"
        exit 0
    fi
    
    # 1. Check SSH
    check_ssh_connection
    
    # 2. Check local project
    print_info "Checking local project..."
    if [ ! -d "$LOCAL_PROJECT" ]; then
        print_error "Local project not found: $LOCAL_PROJECT"
        exit 1
    fi
    print_success "Local project found"
    
    # 3. Create backup directory on VPS
    print_info "Creating backup on VPS..."
    ssh -p $VPS_PORT $VPS_USER@$VPS_IP "
        if [ -d $DEPLOY_PATH ]; then
            BACKUP_DIR=~/backups/backend_\$(date +%Y%m%d_%H%M%S)
            mkdir -p ~/backups
            cp -r $DEPLOY_PATH \$BACKUP_DIR
            echo 'Backup created: '\$BACKUP_DIR
        fi
    "
    print_success "Backup created"
    
    # 4. Create deploy directory
    print_info "Creating deploy directory..."
    ssh -p $VPS_PORT $VPS_USER@$VPS_IP "mkdir -p $DEPLOY_PATH"
    print_success "Deploy directory ready"
    
    # 5. Sync files to VPS (exclude node_modules, dist, logs)
    print_info "Syncing files to VPS..."
    rsync -avz --progress \
        --exclude 'node_modules' \
        --exclude 'dist' \
        --exclude '*.log' \
        --exclude '.git' \
        --exclude '.env.example' \
        -e "ssh -p $VPS_PORT" \
        $LOCAL_PROJECT/ \
        $VPS_USER@$VPS_IP:$DEPLOY_PATH/
    print_success "Files synced"
    
    # 6. Install dependencies and build
    print_info "Installing dependencies and building..."
    ssh -p $VPS_PORT $VPS_USER@$VPS_IP "
        cd $DEPLOY_PATH
        export NODE_OPTIONS=--dns-result-order=ipv4first
        
        echo '📦 Installing dependencies...'
        npm install --production=false
        
        echo '🏗️  Building project...'
        npm run build
        
        echo '✅ Build completed'
    "
    print_success "Build completed"
    
    # 7. Setup PM2 ecosystem
    print_info "Setting up PM2..."
    ssh -p $VPS_PORT $VPS_USER@$VPS_IP "
        cd $DEPLOY_PATH
        
        # Stop existing process
        pm2 stop binary-backend 2>/dev/null || true
        pm2 delete binary-backend 2>/dev/null || true
        
        # Start with PM2
        pm2 start dist/main.js \
            --name binary-backend \
            --instances 1 \
            --max-memory-restart 300M \
            --exp-backoff-restart-delay 100 \
            --env production
        
        # Save PM2 configuration
        pm2 save
        
        # Setup startup script
        sudo env PATH=\$PATH:\$(which node) \$(which pm2) startup systemd -u $VPS_USER --hp /home/$VPS_USER
    "
    print_success "PM2 configured"
    
    # 8. Check status
    print_info "Checking application status..."
    ssh -p $VPS_PORT $VPS_USER@$VPS_IP "
        cd $DEPLOY_PATH
        echo ''
        echo '📊 PM2 Status:'
        pm2 show binary-backend
        echo ''
        echo '📝 Recent logs:'
        pm2 logs binary-backend --lines 20 --nostream
    "
    
    echo ""
    print_success "Deployment completed!"
    echo ""
    echo "=========================================="
    echo "🌐 Your backend is now running at:"
    echo "   http://$VPS_IP:3000"
    echo ""
    echo "📡 API Base URL:"
    echo "   http://$VPS_IP:3000/api/v1"
    echo ""
    echo "📚 API Documentation:"
    echo "   http://$VPS_IP:3000/api/docs"
    echo ""
    echo "🔍 Health Check:"
    echo "   http://$VPS_IP:3000/api/v1/health"
    echo ""
    echo "=========================================="
    echo ""
    echo "📋 Useful commands (on VPS):"
    echo "   pm2 logs binary-backend     # View logs"
    echo "   pm2 restart binary-backend  # Restart"
    echo "   pm2 stop binary-backend     # Stop"
    echo "   pm2 monit                   # Monitor"
    echo "   pm2 show binary-backend     # Detailed info"
    echo ""
    echo "🔧 Update .env on VPS and restart:"
    echo "   ssh $VPS_USER@$VPS_IP"
    echo "   cd $DEPLOY_PATH"
    echo "   nano .env"
    echo "   pm2 restart binary-backend"
    echo ""
}

# Run deployment
main