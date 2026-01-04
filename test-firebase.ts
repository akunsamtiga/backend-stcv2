// test-firebase-connection.ts
// Test Firebase Realtime Database connection
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  console.log('🔍 Testing Firebase Connection...');
  console.log('');

  // 1. Check Environment Variables
  console.log('📋 Step 1: Checking Environment Variables');
  console.log('   PROJECT_ID:', process.env.FIREBASE_PROJECT_ID);
  console.log('   CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL);
  console.log('   DB_URL:', process.env.FIREBASE_REALTIME_DB_URL);
  console.log('   PRIVATE_KEY (first 50 chars):', process.env.FIREBASE_PRIVATE_KEY?.substring(0, 50));
  console.log('');

  if (!process.env.FIREBASE_PROJECT_ID || 
      !process.env.FIREBASE_PRIVATE_KEY || 
      !process.env.FIREBASE_CLIENT_EMAIL ||
      !process.env.FIREBASE_REALTIME_DB_URL) {
    console.error('❌ Missing environment variables!');
    process.exit(1);
  }

  try {
    // 2. Initialize Firebase
    console.log('🔧 Step 2: Initializing Firebase Admin SDK...');
    
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        databaseURL: process.env.FIREBASE_REALTIME_DB_URL,
      });
    }
    
    console.log('✅ Firebase initialized');
    console.log('');

    // 3. Test Firestore
    console.log('🔍 Step 3: Testing Firestore...');
    const db = admin.firestore();
    await db.collection('_test').doc('_test').set({ 
      test: true, 
      timestamp: new Date().toISOString() 
    });
    console.log('✅ Firestore: Connected & Writable');
    console.log('');

    // 4. Test Realtime Database - METHOD 1: Admin SDK
    console.log('🔍 Step 4: Testing Realtime Database (Admin SDK)...');
    const realtimeDb = admin.database();
    
    try {
      // Test write
      await realtimeDb.ref('_test/connection_test').set({
        status: 'connected',
        timestamp: Date.now(),
        method: 'admin_sdk',
      });
      console.log('✅ Realtime DB (Admin SDK): Write successful');

      // Test read
      const snapshot = await realtimeDb.ref('_test/connection_test').once('value');
      const data = snapshot.val();
      console.log('✅ Realtime DB (Admin SDK): Read successful');
      console.log('   Data:', JSON.stringify(data, null, 2));
      
    } catch (error: any) {
      console.error('❌ Realtime DB (Admin SDK) failed:', error.message);
      console.error('   Error code:', error.code);
      console.error('   Full error:', error);
    }
    console.log('');

    // 5. Test Realtime Database - METHOD 2: REST API
    console.log('🔍 Step 5: Testing Realtime Database (REST API)...');
    try {
      const axios = (await import('axios')).default;
      const baseURL = process.env.FIREBASE_REALTIME_DB_URL!.replace(/\/$/, '');
      
      // Test write via REST
      const writeResponse = await axios.put(
        `${baseURL}/_test/rest_test.json`,
        {
          status: 'connected',
          timestamp: Date.now(),
          method: 'rest_api',
        },
        {
          params: {
            // Use service account to get auth token
            auth: await admin.credential.cert(serviceAccount as admin.ServiceAccount)
              .getAccessToken()
              .then(token => token.access_token)
          }
        }
      );
      console.log('✅ Realtime DB (REST): Write successful');

      // Test read via REST
      const readResponse = await axios.get(
        `${baseURL}/_test/rest_test.json`,
        {
          params: {
            auth: await admin.credential.cert(serviceAccount as admin.ServiceAccount)
              .getAccessToken()
              .then(token => token.access_token)
          }
        }
      );
      console.log('✅ Realtime DB (REST): Read successful');
      console.log('   Data:', JSON.stringify(readResponse.data, null, 2));
      
    } catch (error: any) {
      console.error('❌ Realtime DB (REST) failed:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', error.response.data);
      }
    }
    console.log('');

    // 6. Test specific path for trading
    console.log('🔍 Step 6: Testing Trading Paths...');
    try {
      await realtimeDb.ref('/idx_stc/current_price').set({
        price: 40.123456,
        timestamp: Math.floor(Date.now() / 1000),
        datetime: new Date().toISOString(),
        test: true,
      });
      console.log('✅ Trading path (/idx_stc/current_price): Write successful');

      const tradingSnapshot = await realtimeDb.ref('/idx_stc/current_price').once('value');
      console.log('✅ Trading path: Read successful');
      console.log('   Data:', JSON.stringify(tradingSnapshot.val(), null, 2));
      
    } catch (error: any) {
      console.error('❌ Trading path failed:', error.message);
    }
    console.log('');

    // 7. Check Database Rules
    console.log('🔍 Step 7: Testing Database Permissions...');
    try {
      // Try to read .info/connected (always readable)
      const connectedSnapshot = await realtimeDb.ref('/.info/connected').once('value');
      console.log('✅ Can read system info (.info/connected):', connectedSnapshot.val());
      
      // Try to read root
      const rootSnapshot = await realtimeDb.ref('/').limitToFirst(1).once('value');
      console.log('✅ Can read root path');
      
    } catch (error: any) {
      console.error('❌ Permission check failed:', error.message);
      console.log('');
      console.log('⚠️  Database rules might be too restrictive!');
      console.log('   Go to Firebase Console > Realtime Database > Rules');
      console.log('   Set rules to:');
      console.log('   {');
      console.log('     "rules": {');
      console.log('       ".read": true,');
      console.log('       ".write": true');
      console.log('     }');
      console.log('   }');
    }
    console.log('');

    // Summary
    console.log('📊 ================================================');
    console.log('📊 CONNECTION TEST SUMMARY');
    console.log('📊 ================================================');
    console.log('✅ All tests completed!');
    console.log('');
    console.log('If you see ❌ errors above, fix them first before running the simulator.');
    console.log('');
    console.log('Next steps:');
    console.log('1. If Realtime DB failed: Check database URL');
    console.log('2. If permissions failed: Update database rules');
    console.log('3. If credentials failed: Regenerate service account key');
    console.log('');

    process.exit(0);

  } catch (error: any) {
    console.error('');
    console.error('💥 ================================================');
    console.error('💥 FATAL ERROR');
    console.error('💥 ================================================');
    console.error('Message:', error.message);
    console.error('Code:', error.code);
    console.error('Stack:', error.stack);
    console.error('');
    console.error('🔧 Troubleshooting:');
    console.error('1. Check .env file is correct');
    console.error('2. Verify Realtime Database exists in Firebase Console');
    console.error('3. Check database rules allow read/write');
    console.error('4. Regenerate service account key if needed');
    console.error('');
    process.exit(1);
  }
}

testConnection();