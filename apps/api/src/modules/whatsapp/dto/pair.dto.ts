import { IsString, Matches } from 'class-validator';

export class PairDto {
  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'phone must be digits only, 10-15 chars (e.g. 5547999999999)' })
  phone: string;
}
