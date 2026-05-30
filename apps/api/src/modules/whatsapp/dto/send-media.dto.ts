import { IsString, IsNotEmpty, IsIn, IsOptional, IsUrl } from 'class-validator';

export class SendMediaDto {
  @IsString() @IsNotEmpty()
  conversationId!: string;

  @IsUrl()
  mediaUrl!: string;

  @IsIn(['image', 'video', 'audio', 'document'])
  mediaType!: 'image' | 'video' | 'audio' | 'document';

  @IsString() @IsNotEmpty()
  fileName!: string;

  @IsString() @IsOptional()
  caption?: string;
}
