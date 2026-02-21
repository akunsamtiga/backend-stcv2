// src/auto-lose-system/auto-lose-system.module.ts

import { Module } from '@nestjs/common';
import { AutoLoseSystemService } from './auto-lose-system.service';
import { AutoLoseSystemController } from './auto-lose-system.controller';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [FirebaseModule],
  controllers: [AutoLoseSystemController],
  providers: [AutoLoseSystemService],
  exports: [AutoLoseSystemService],
})
export class AutoLoseSystemModule {}