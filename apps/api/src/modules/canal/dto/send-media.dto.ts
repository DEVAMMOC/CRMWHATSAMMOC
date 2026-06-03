import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

export class CanalSendMediaDto {
  @IsString() @IsNotEmpty() mediaUrl!: string;
  @IsIn(['image', 'audio', 'video', 'document']) mediaType!: 'image' | 'audio' | 'video' | 'document';
  @IsString() @IsNotEmpty() fileName!: string;
  @IsString() @IsOptional() caption?: string;
}
