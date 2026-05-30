import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AddNumberDto {
  @IsString() @IsNotEmpty() phoneNumberId!: string;
  @IsString() @IsNotEmpty() displayNumber!: string;
  @IsString() @IsOptional() label?: string;
}
