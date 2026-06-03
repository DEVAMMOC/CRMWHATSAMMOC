import { IsIn } from 'class-validator';

export class CanalStatusDto {
  @IsIn(['open', 'human', 'closed'])
  status!: 'open' | 'human' | 'closed';
}
