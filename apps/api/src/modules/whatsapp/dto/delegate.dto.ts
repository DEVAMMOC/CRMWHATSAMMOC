import { IsUUID, IsOptional } from 'class-validator';

export class DelegateDto {
  @IsUUID()
  @IsOptional()
  sectorId?: string;

  @IsUUID()
  @IsOptional()
  assignedTo?: string;
}
