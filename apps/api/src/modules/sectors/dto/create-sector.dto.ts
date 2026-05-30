import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateSectorDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

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
