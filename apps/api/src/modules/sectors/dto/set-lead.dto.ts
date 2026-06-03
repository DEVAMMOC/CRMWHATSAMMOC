import { IsBoolean } from 'class-validator';

export class SetLeadDto {
  @IsBoolean()
  lead!: boolean;
}
