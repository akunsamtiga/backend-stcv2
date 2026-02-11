// src/information/information.service.ts

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateInformationDto } from './dto/create-information.dto';
import { UpdateInformationDto } from './dto/update-information.dto';
import { GetInformationQueryDto } from './dto/get-information-query.dto';
import { PaginatedResponse } from '../common/interfaces';

const COLLECTIONS = {
  INFORMATION: 'information',
  USERS: 'users',
};

const STORAGE_FOLDERS = {
  INFORMATION: 'information',
};

export interface Information {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  type: string;
  priority: string;
  imageUrl?: string;
  imagePath?: string;
  imageSize?: number;
  linkUrl?: string;
  linkText?: string;
  startDate?: string;
  endDate?: string;
  publishDate?: string;
  isActive: boolean;
  isPinned: boolean;
  targetUserStatus?: string[];
  targetUserRoles?: string[];
  createdBy: string;
  createdByEmail?: string;
  updatedBy?: string;
  updatedByEmail?: string;
  createdAt: string;
  updatedAt?: string;
  viewCount?: number;
  clickCount?: number;
}

@Injectable()
export class InformationService {
  private readonly logger = new Logger(InformationService.name);

  constructor(private firebaseService: FirebaseService) {}

  /**
   * Upload image for information
   */
  async uploadImage(
    file: Express.Multer.File,
    adminId: string,
    adminEmail: string,
  ): Promise<{ url: string; path: string; size: number }> {
    try {
      if (!file) {
        throw new BadRequestException('No file provided');
      }

      if (!file.buffer || file.buffer.length === 0) {
        throw new BadRequestException('File is empty or corrupted');
      }

      const validMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!validMimeTypes.includes(file.mimetype)) {
        throw new BadRequestException(
          `Invalid file type: ${file.mimetype}. Allowed: JPEG, PNG, GIF, WebP`
        );
      }

      this.logger.log(`📤 Starting image upload for ${adminEmail}, size: ${file.size} bytes, type: ${file.mimetype}`);

      const result = await this.firebaseService.uploadImage(
        file,
        STORAGE_FOLDERS.INFORMATION,
      );

      if (!result || !result.url || !result.path) {
        throw new BadRequestException('Upload succeeded but response is incomplete');
      }

      this.logger.log(`📸 Image uploaded by ${adminEmail}: ${result.path}`);

      return result;
    } catch (error) {
      this.logger.error(`❌ uploadImage error: ${error.message}`);
      
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      throw new BadRequestException(`Failed to upload image: ${error.message}`);
    }
  }

  /**
   * Delete image from storage
   */
  async deleteImage(imagePath: string, adminEmail: string): Promise<void> {
    try {
      if (!imagePath) {
        throw new BadRequestException('Image path is required');
      }

      await this.firebaseService.deleteImage(imagePath);
      this.logger.log(`🗑️ Image deleted by ${adminEmail}: ${imagePath}`);
    } catch (error) {
      this.logger.error(`❌ deleteImage error: ${error.message}`);
      
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      throw new BadRequestException(`Failed to delete image: ${error.message}`);
    }
  }

  /**
   * Create new information (Admin only)
   */
  async createInformation(
    createDto: CreateInformationDto,
    adminId: string,
    adminEmail: string,
  ): Promise<Information> {
    try {
      const db = this.firebaseService.getFirestore();
      const now = new Date().toISOString();

      const informationData = {
        title: createDto.title,
        subtitle: createDto.subtitle || null,
        description: createDto.description,
        type: createDto.type,
        priority: createDto.priority || 'medium',
        imageUrl: createDto.imageUrl || null,
        imagePath: createDto.imagePath || null,
        imageSize: createDto.imageSize || null,
        linkUrl: createDto.linkUrl || null,
        linkText: createDto.linkText || null,
        startDate: createDto.startDate || null,
        endDate: createDto.endDate || null,
        publishDate: createDto.publishDate || now,
        isActive: createDto.isActive ?? true,
        isPinned: createDto.isPinned ?? false,
        targetUserStatus: createDto.targetUserStatus || null,
        targetUserRoles: createDto.targetUserRoles || null,
        createdBy: adminId,
        createdByEmail: adminEmail,
        createdAt: now,
        viewCount: 0,
        clickCount: 0,
      };

      const docRef = await db.collection(COLLECTIONS.INFORMATION).add(informationData);

      this.logger.log(`✅ Information created: ${docRef.id} by ${adminEmail}`);

      return {
        id: docRef.id,
        ...informationData,
      } as Information;
    } catch (error) {
      this.logger.error(`❌ createInformation error: ${error.message}`);
      throw new BadRequestException('Failed to create information');
    }
  }

  /**
   * Get all information with filters and pagination (Admin only)
   */
  async getAllInformation(query: GetInformationQueryDto): Promise<PaginatedResponse<Information>> {
    try {
      const db = this.firebaseService.getFirestore();
      let baseQuery = db.collection(COLLECTIONS.INFORMATION);

      // Apply filters
      if (query.isActive !== undefined) {
        baseQuery = baseQuery.where('isActive', '==', query.isActive) as any;
      }

      if (query.isPinned !== undefined) {
        baseQuery = baseQuery.where('isPinned', '==', query.isPinned) as any;
      }

      if (query.type) {
        baseQuery = baseQuery.where('type', '==', query.type) as any;
      }

      if (query.priority) {
        baseQuery = baseQuery.where('priority', '==', query.priority) as any;
      }

      // Apply sorting
      const sortField = query.sortBy || 'createdAt';
      const sortDirection = query.sortOrder === 'asc' ? 'asc' : 'desc';
      baseQuery = baseQuery.orderBy(sortField, sortDirection) as any;

      // Get all documents first
      const snapshot = await baseQuery.get();
      let items: Information[] = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        items.push({
          id: doc.id,
          ...data,
        } as Information);
      });

      // Apply search filter (client-side since Firestore doesn't support full-text search)
      if (query.search) {
        const searchLower = query.search.toLowerCase();
        items = items.filter(item => 
          item.title.toLowerCase().includes(searchLower) ||
          item.description.toLowerCase().includes(searchLower) ||
          (item.subtitle && item.subtitle.toLowerCase().includes(searchLower))
        );
      }

      // Apply pagination
      const total = items.length;
      const page = query.page || 1;
      const limit = query.limit || 20;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedItems = items.slice(startIndex, endIndex);

      this.logger.log(`📄 Retrieved ${paginatedItems.length} of ${total} information items`);

      return {
        items: paginatedItems,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      this.logger.error(`❌ getAllInformation error: ${error.message}`);
      throw new BadRequestException('Failed to retrieve information');
    }
  }

  /**
   * Get active information for user (with targeting)
   */
  async getActiveInformation(
    userStatus: string,
    userRole: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponse<Information>> {
    try {
      const db = this.firebaseService.getFirestore();
      const now = new Date().toISOString();

      // Get active information
      const snapshot = await db
        .collection(COLLECTIONS.INFORMATION)
        .where('isActive', '==', true)
        .orderBy('isPinned', 'desc')
        .orderBy('publishDate', 'desc')
        .get();

      const items: Information[] = [];

      snapshot.forEach(doc => {
        const info = {
          id: doc.id,
          ...doc.data(),
        } as Information;

        // Check if information is within display period
        if (info.startDate && info.startDate > now) {
          return; // Not yet started
        }

        if (info.endDate && info.endDate < now) {
          return; // Already ended
        }

        // Check targeting
        const hasStatusTarget = info.targetUserStatus && info.targetUserStatus.length > 0;
        const hasRoleTarget = info.targetUserRoles && info.targetUserRoles.length > 0;

        // If targeting is set, check if user matches
        if (hasStatusTarget || hasRoleTarget) {
          const matchesStatus = !hasStatusTarget || (info.targetUserStatus?.includes(userStatus) ?? false);
          const matchesRole = !hasRoleTarget || (info.targetUserRoles?.includes(userRole) ?? false);

          if (!matchesStatus || !matchesRole) {
            return; // Skip items that don't match targeting
          }
        }

        items.push(info);
      });

      // Apply pagination
      const total = items.length;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedItems = items.slice(startIndex, endIndex);

      this.logger.log(`📢 Retrieved ${paginatedItems.length} active information for user (${userStatus}/${userRole})`);

      return {
        items: paginatedItems,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      this.logger.error(`❌ getActiveInformation error: ${error.message}`);
      throw new BadRequestException('Failed to retrieve active information');
    }
  }

  // ✅ NEW: Get pinned information specifically
  async getPinnedInformation(userStatus: string, userRole: string): Promise<Information | null> {
    try {
      const db = this.firebaseService.getFirestore();
      const now = new Date().toISOString();

      this.logger.log(`🔍 Searching for pinned information for user (${userStatus}/${userRole})`);

      // Query for pinned and active information
      const snapshot = await db
        .collection(COLLECTIONS.INFORMATION)
        .where('isActive', '==', true)
        .where('isPinned', '==', true)
        .limit(1)
        .get();

      if (snapshot.empty) {
        this.logger.log('ℹ️ No pinned information found in database');
        return null;
      }

      const doc = snapshot.docs[0];
      const info = {
        id: doc.id,
        ...doc.data(),
      } as Information;

      // Check date constraints
      if (info.startDate && info.startDate > now) {
        this.logger.log(`⏳ Pinned information not yet started (startDate: ${info.startDate})`);
        return null;
      }

      if (info.endDate && info.endDate < now) {
        this.logger.log(`⌛ Pinned information already expired (endDate: ${info.endDate})`);
        return null;
      }

      // Check targeting
      const hasStatusTarget = info.targetUserStatus && info.targetUserStatus.length > 0;
      const hasRoleTarget = info.targetUserRoles && info.targetUserRoles.length > 0;

      if (hasStatusTarget || hasRoleTarget) {
        const matchesStatus = !hasStatusTarget || info.targetUserStatus?.includes(userStatus);
        const matchesRole = !hasRoleTarget || info.targetUserRoles?.includes(userRole);

        if (!matchesStatus || !matchesRole) {
          this.logger.log(`🚫 User does not match targeting criteria`);
          return null;
        }
      }

      this.logger.log(`✅ Found pinned information: ${info.title}`);
      return info;

    } catch (error) {
      this.logger.error(`❌ getPinnedInformation error: ${error.message}`);
      return null;
    }
  }

  /**
   * Get information by ID
   */
  async getInformationById(id: string): Promise<Information> {
    try {
      const db = this.firebaseService.getFirestore();
      const doc = await db.collection(COLLECTIONS.INFORMATION).doc(id).get();

      if (!doc.exists) {
        throw new NotFoundException(`Information with ID ${id} not found`);
      }

      return {
        id: doc.id,
        ...doc.data(),
      } as Information;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`❌ getInformationById error: ${error.message}`);
      throw new BadRequestException('Failed to retrieve information');
    }
  }

  /**
   * Update information (Admin only)
   */
  async updateInformation(
    id: string,
    updateDto: UpdateInformationDto,
    adminId: string,
    adminEmail: string,
  ): Promise<Information> {
    try {
      const db = this.firebaseService.getFirestore();
      const docRef = db.collection(COLLECTIONS.INFORMATION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new NotFoundException(`Information with ID ${id} not found`);
      }

      const currentData = doc.data();

      // If updating image URL, delete old image if exists
      if (updateDto.imageUrl && currentData?.imagePath && currentData.imagePath !== updateDto.imagePath) {
        try {
          await this.firebaseService.deleteImage(currentData.imagePath);
          this.logger.log(`🗑️ Old image deleted: ${currentData.imagePath}`);
        } catch (error) {
          this.logger.warn(`Failed to delete old image: ${error.message}`);
        }
      }

      const updateData: any = {
        ...updateDto,
        updatedBy: adminId,
        updatedByEmail: adminEmail,
        updatedAt: new Date().toISOString(),
      };

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      await docRef.update(updateData);

      const updatedDoc = await docRef.get();

      this.logger.log(`✅ Information updated: ${id} by ${adminEmail}`);

      return {
        id: updatedDoc.id,
        ...updatedDoc.data(),
      } as Information;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`❌ updateInformation error: ${error.message}`);
      throw new BadRequestException('Failed to update information');
    }
  }

  /**
   * Delete information (Admin only)
   */
  async deleteInformation(id: string, adminEmail: string): Promise<void> {
    try {
      const db = this.firebaseService.getFirestore();
      const docRef = db.collection(COLLECTIONS.INFORMATION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new NotFoundException(`Information with ID ${id} not found`);
      }

      const data = doc.data();

      // Delete associated image if exists
      if (data?.imagePath) {
        try {
          await this.firebaseService.deleteImage(data.imagePath);
          this.logger.log(`🗑️ Image deleted: ${data.imagePath}`);
        } catch (error) {
          this.logger.warn(`Failed to delete image: ${error.message}`);
        }
      }

      await docRef.delete();

      this.logger.log(`🗑️ Information deleted: ${id} by ${adminEmail}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`❌ deleteInformation error: ${error.message}`);
      throw new BadRequestException('Failed to delete information');
    }
  }

  /**
   * Increment view count
   */
  async incrementViewCount(id: string): Promise<void> {
    try {
      const db = this.firebaseService.getFirestore();
      const docRef = db.collection(COLLECTIONS.INFORMATION).doc(id);
      
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) {
          return;
        }

        const currentCount = doc.data()?.viewCount || 0;
        transaction.update(docRef, { viewCount: currentCount + 1 });
      });

      this.logger.debug(`👁️ View count incremented for information: ${id}`);
    } catch (error) {
      this.logger.error(`❌ incrementViewCount error: ${error.message}`);
      // Don't throw error, just log it
    }
  }

  /**
   * Increment click count
   */
  async incrementClickCount(id: string): Promise<void> {
    try {
      const db = this.firebaseService.getFirestore();
      const docRef = db.collection(COLLECTIONS.INFORMATION).doc(id);
      
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) {
          return;
        }

        const currentCount = doc.data()?.clickCount || 0;
        transaction.update(docRef, { clickCount: currentCount + 1 });
      });

      this.logger.debug(`🖱️ Click count incremented for information: ${id}`);
    } catch (error) {
      this.logger.error(`❌ incrementClickCount error: ${error.message}`);
      // Don't throw error, just log it
    }
  }

  /**
   * Toggle active status
   */
  async toggleActiveStatus(id: string, adminId: string, adminEmail: string): Promise<Information> {
    try {
      const db = this.firebaseService.getFirestore();
      const docRef = db.collection(COLLECTIONS.INFORMATION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new NotFoundException(`Information with ID ${id} not found`);
      }

      const currentData = doc.data();
      const newActiveStatus = !currentData?.isActive;

      await docRef.update({
        isActive: newActiveStatus,
        updatedBy: adminId,
        updatedByEmail: adminEmail,
        updatedAt: new Date().toISOString(),
      });

      const updatedDoc = await docRef.get();

      this.logger.log(`🔄 Information status toggled: ${id} → ${newActiveStatus ? 'ACTIVE' : 'INACTIVE'} by ${adminEmail}`);

      return {
        id: updatedDoc.id,
        ...updatedDoc.data(),
      } as Information;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`❌ toggleActiveStatus error: ${error.message}`);
      throw new BadRequestException('Failed to toggle information status');
    }
  }
}