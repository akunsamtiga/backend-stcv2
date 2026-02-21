// src/auto-lose-system/auto-lose-system.module.ts

import { Module } from '@nestjs/common';
import { AutoLoseSystemService } from './auto-lose-system.service';
import { AutoLoseSystemController } from './auto-lose-system.controller';
import { FirebaseModule } from '../firebase/firebase.module';
import { AuthModule } from '../auth/auth.module'; 

@Module({
  imports: [
    FirebaseModule,
    AuthModule, 
  ],
  controllers: [AutoLoseSystemController],
  providers: [AutoLoseSystemService],
  exports: [AutoLoseSystemService],
})
export class AutoLoseSystemModule {}