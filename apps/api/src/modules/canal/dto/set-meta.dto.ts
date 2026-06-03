import { IsString, IsOptional } from 'class-validator';

export class CanalSetMetaDto {
  @IsString() @IsOptional() subject?: string;
  @IsString() @IsOptional() municipality?: string;
}
