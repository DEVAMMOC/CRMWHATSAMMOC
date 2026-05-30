import { IsUUID, IsOptional } from 'class-validator';

export class CanalDelegateDto {
  @IsUUID() @IsOptional() sectorId?: string;
  @IsUUID() @IsOptional() assignedTo?: string;
}
