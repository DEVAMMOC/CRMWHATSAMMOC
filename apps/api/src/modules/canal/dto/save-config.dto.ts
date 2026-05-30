import { IsString, IsOptional } from 'class-validator';

export class SaveConfigDto {
  @IsString() @IsOptional() wabaId?: string;
  @IsString() @IsOptional() accessToken?: string;
  @IsString() @IsOptional() verifyToken?: string;
  @IsString() @IsOptional() appSecret?: string;
}
