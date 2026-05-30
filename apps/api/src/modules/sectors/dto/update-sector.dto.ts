import { IsString, IsOptional, IsArray } from 'class-validator';

export class UpdateSectorDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  keywords?: string[];

  @IsString()
  @IsOptional()
  color?: string;
}
