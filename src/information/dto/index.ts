// src/information/dto/index.ts

// Export DTOs
export * from './create-information.dto';
export * from './update-information.dto';
export * from './get-information-query.dto';

// Explicitly re-export enums from create-information.dto to avoid ambiguity
export { InformationType, InformationPriority } from './create-information.dto';