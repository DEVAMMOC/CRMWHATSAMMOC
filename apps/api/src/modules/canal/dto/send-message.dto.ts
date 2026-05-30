import { IsString, IsNotEmpty } from 'class-validator';

export class CanalSendMessageDto {
  @IsString() @IsNotEmpty() text!: string;
}
