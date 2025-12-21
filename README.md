# Binary Option Trading System 🚀

Complete binary option trading platform with multi-asset support, configurable profit rates, and role-based access control.

## 🎯 Features

### Core Features
- 🔐 **RBAC** - Super Admin, Admin, User roles
- 💰 **Balance System** - Deposits, withdrawals, wins, losses
- 📊 **Multiple Assets** - IDX_STC and more with configurable profit rates
- ⏱️ **Flexible Durations** - 1,2,3,4,5,15,30,45,60 minute options
- 🔥 **Real-time Prices** - Firebase Realtime DB integration
- 🎲 **Binary Options** - CALL/PUT trading with automatic settlement
- 📈 **Statistics** - Win rate, total trades, profit/loss tracking

### Technical Features
- 📚 **Swagger Docs** - Interactive API documentation
- 🛡️ **Security** - JWT, helmet, CORS, rate limiting
- 🪵 **Logging** - Winston structured logging
- ⏰ **Cron Jobs** - Automatic order settlement
- ✅ **Validation** - Request validation with class-validator
- 🎨 **Clean Architecture** - Modular, testable, maintainable

## 🚀 Quick Start

### 1. Run Setup
```bash
bash setup.sh
cd binary-trading-backend
```

### 2. Configure Firebase
Update `.env` with your Firebase credentials:
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_REALTIME_DB_URL=https://your-project-default-rtdb.region.firebasedatabase.app/
```

### 3. Configure Super Admin
```env
SUPER_ADMIN_EMAIL=superadmin@trading.com
SUPER_ADMIN_PASSWORD=SuperAdmin123!
```

### 4. Install & Run
```bash
npm install
npm run start:dev
```

### 5. Create Initial Asset (IDX_STC)
```bash
curl -X POST http://localhost:3000/api/v1/assets \
  -H "Authorization: Bearer SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "IDX STC",
    "symbol": "IDX_STC",
    "profitRate": 85,
    "isActive": true,
    "dataSource": "realtime_db",
    "realtimeDbPath": "/idx_stc/current_price",
    "description": "Indonesian Stock Index STC"
  }'
```

## 📡 API Endpoints

### Base URL
```
http://localhost:3000/api/v1
```

### Authentication
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | `/auth/register` | Register user | Public |
| POST | `/auth/login` | Login | Public |

### User
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | `/user/profile` | Get profile | User |

### Balance
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | `/balance` | Create transaction | User |
| GET | `/balance` | Get history | User |
| GET | `/balance/current` | Current balance | User |

### Assets
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | `/assets` | Create asset | Admin |
| GET | `/assets` | Get all assets | User |
| GET | `/assets/:id` | Get asset | User |
| GET | `/assets/:id/price` | Get current price | User |
| PUT | `/assets/:id` | Update asset | Admin |
| DELETE | `/assets/:id` | Delete asset | Super Admin |

### Binary Orders
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | `/binary-orders` | Create order | User |
| GET | `/binary-orders` | Get orders | User |
| GET | `/binary-orders/:id` | Get order | User |

### Admin
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | `/admin/users` | Create user | Admin |
| GET | `/admin/users` | Get all users | Admin |
| GET | `/admin/users/:id` | Get user | Admin |
| PUT | `/admin/users/:id` | Update user | Admin |
| DELETE | `/admin/users/:id` | Delete user | Super Admin |

## 🎮 Usage Examples

### 1. Login as Super Admin
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "superadmin@trading.com",
    "password": "SuperAdmin123!"
  }'
```

### 2. Create IDX_STC Asset (Admin)
```bash
curl -X POST http://localhost:3000/api/v1/assets \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "IDX STC",
    "symbol": "IDX_STC",
    "profitRate": 85,
    "isActive": true,
    "dataSource": "realtime_db",
    "realtimeDbPath": "/idx_stc/current_price",
    "description": "Indonesian Stock Index"
  }'
```

### 3. Register User
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "trader@example.com",
    "password": "TraderPass123!"
  }'
```

### 4. Deposit Balance
```bash
curl -X POST http://localhost:3000/api/v1/balance \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "deposit",
    "amount": 10000,
    "description": "Initial deposit"
  }'
```

### 5. Get Current Asset Price
```bash
curl -X GET http://localhost:3000/api/v1/assets/ASSET_ID/price \
  -H "Authorization: Bearer USER_TOKEN"
```

### 6. Create Binary Order (CALL - 1 minute)
```bash
curl -X POST http://localhost:3000/api/v1/binary-orders \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "asset_id": "ASSET_ID",
    "direction": "CALL",
    "amount": 1000,
    "duration": 1
  }'
```

### 7. Create Binary Order (PUT - 15 minutes)
```bash
curl -X POST http://localhost:3000/api/v1/binary-orders \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "asset_id": "ASSET_ID",
    "direction": "PUT",
    "amount": 500,
    "duration": 15
  }'
```

## 🗄️ Database Schema

### Collections

#### users
```typescript
{
  id: string;
  email: string;
  password: string; // bcrypt hashed
  role: 'super_admin' | 'admin' | 'user';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}
```

#### balance
```typescript
{
  id: string;
  user_id: string;
  type: 'deposit' | 'withdrawal' | 'win' | 'lose';
  amount: number;
  description: string;
  createdAt: string;
}
```

#### assets
```typescript
{
  id: string;
  name: string;
  symbol: string;
  profitRate: number; // 0-100
  isActive: boolean;
  dataSource: 'realtime_db' | 'api' | 'mock';
  realtimeDbPath?: string;
  apiEndpoint?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}
```

#### binary_orders
```typescript
{
  id: string;
  user_id: string;
  asset_id: string;
  asset_name: string;
  direction: 'CALL' | 'PUT';
  amount: number;
  duration: number; // minutes
  entry_price: number;
  entry_time: string;
  exit_price: number | null;
  exit_time: string;
  status: 'PENDING' | 'ACTIVE' | 'WON' | 'LOST' | 'EXPIRED';
  profit: number | null;
  profitRate: number;
  createdAt: string;
}
```

## 🧮 Binary Option Logic

### Trading Flow
1. User places order with entry price at current market price
2. Order is ACTIVE for specified duration (1-60 minutes)
3. At expiry, system compares exit price with entry price
4. Result determined by direction:
   - **CALL**: WON if exit_price > entry_price
   - **PUT**: WON if exit_price < entry_price

### Profit Calculation
```typescript
// WON
profit = (amount * profitRate) / 100

// LOST
profit = -amount

// Example: $1000 order, 85% profit rate
// WON: +$850 profit (return $1850)
// LOST: -$1000 (lose all)
```

### Durations
- **Short Term**: 1, 2, 3, 4, 5 minutes
- **Medium Term**: 15, 30, 45, 60 minutes

### Auto Settlement
- Cron job runs every 10 seconds
- Checks for expired ACTIVE orders
- Fetches exit price from data source
- Determines WON/LOST result
- Updates balance automatically

## 👥 Role Permissions

### Super Admin
- All admin permissions
- Delete assets
- Delete users
- System configuration

### Admin
- Create/update assets
- Create/update users
- View all user data
- Configure profit rates

### User
- Register/login
- View own profile
- Manage balance
- Place binary orders
- View own orders
- View active assets

## 🔧 Configuration

### Asset Profit Rates
Each asset can have different profit rates (0-100%). Example:
- IDX_STC: 85%
- Forex pairs: 80%
- Crypto: 90%

### Data Sources

#### 1. Firebase Realtime DB (Recommended for IDX_STC)
```json
{
  "dataSource": "realtime_db",
  "realtimeDbPath": "/idx_stc/current_price"
}
```

#### 2. External API
```json
{
  "dataSource": "api",
  "apiEndpoint": "https://api.example.com/price"
}
```

#### 3. Mock Data (Testing)
```json
{
  "dataSource": "mock"
}
```

## 📊 Monitoring

### Health Check
```bash
curl http://localhost:3000/api/v1/health
```

### Logs
Logs are written to:
- Console (stdout)
- File: `logs/app.log` (Winston)

### Key Metrics
- Active orders count
- Win rate per user
- Total volume
- Profit/loss tracking

## 🔐 Security

- ✅ JWT authentication
- ✅ Role-based authorization
- ✅ Password hashing (bcrypt, 12 rounds)
- ✅ Request validation
- ✅ Rate limiting (100 req/min)
- ✅ Helmet security headers
- ✅ CORS configuration
- ✅ SQL injection prevention (Firestore)

## 🚀 Deployment

### Production Checklist
1. Update `.env` with production Firebase credentials
2. Set strong `JWT_SECRET` (min 32 chars)
3. Configure `CORS_ORIGIN` to production domain
4. Set `NODE_ENV=production`
5. Run `npm run build`
6. Start with `npm run start:prod`
7. Setup reverse proxy (nginx)
8. Enable HTTPS
9. Configure firewall
10. Setup monitoring

## 🧪 Testing

### Run Tests
```bash
npm test
npm run test:watch
npm run test:cov
```

### Test Binary Order Flow
1. Start main.py (IDX_STC simulator)
2. Create asset via API
3. Register user and deposit balance
4. Place CALL order for 1 minute
5. Wait for settlement
6. Check balance and order status

## 📝 Scripts

```bash
npm run start         # Production
npm run start:dev     # Development
npm run start:debug   # Debug mode
npm run build         # Build
npm run format        # Format code
npm run lint          # Lint code
```

## 🔄 Integration with IDX_STC Simulator

The system integrates with your Python simulator (`main.py`):

1. **Simulator** writes price data to Firebase Realtime DB:
   ```
   /idx_stc/current_price
   {
     price: 40.123,
     timestamp: 1234567890,
     datetime: "2024-12-19 10:30:00"
   }
   ```

2. **Backend** reads from the same path when:
   - User requests current price
   - Binary order is created (entry price)
   - Binary order expires (exit price)

3. **Asset Configuration**:
   ```json
   {
     "symbol": "IDX_STC",
     "dataSource": "realtime_db",
     "realtimeDbPath": "/idx_stc/current_price"
   }
   ```

## 🐛 Troubleshooting

### Firebase Connection Error
- Verify credentials in `.env`
- Check Firestore and Realtime DB are enabled
- Ensure private key format is correct

### Order Not Settling
- Check cron job is running (logs every 10 seconds)
- Verify price data is available
- Check Firebase Realtime DB connection

### Insufficient Balance
- Verify balance calculation logic
- Check all transactions in balance collection

## 📚 Documentation

- Swagger: `http://localhost:3000/api/docs`
- Health: `http://localhost:3000/api/v1/health`

## 🤝 Contributing

Contributions welcome! Please:
1. Follow coding standards
2. Add tests for new features
3. Update documentation
4. Submit PR with description

## 📄 License

MIT

---

**Built with ❤️ using NestJS, Firebase, and TypeScript**

Version: 3.0.0 | Binary Option Trading System
