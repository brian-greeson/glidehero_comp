import { UserRow } from '../db/types.js';

export type AccountDTO = {
  id: string;
  email: string;
};

export function toAccountDTO(user: UserRow): AccountDTO {
  return {
    id: user.id,
    email: user.email ?? '',
  };
}
