type PendingInviteRow = {
  id: string;
  pending_invite?: boolean | null;
  pending_invite_id?: number | null;
  pending_invited_by_name?: string | null;
};

export type PendingInviteAction = "accept" | "decline";

export type PendingInviteActionModel = {
  pending: boolean;
  inviter: string;
  billId: string;
  inviteId: number | null;
};

export function pendingInviteActionModel(row: PendingInviteRow): PendingInviteActionModel {
  const inviteId = row.pending_invite_id ?? null;
  return {
    pending: Boolean(row.pending_invite && inviteId !== null),
    inviter: row.pending_invited_by_name || "Pengundang",
    billId: row.id,
    inviteId,
  };
}

export function pendingInviteActionArgs(row: PendingInviteRow, _action: PendingInviteAction): [string, number] | null {
  const model = pendingInviteActionModel(row);
  return model.pending && model.inviteId !== null ? [model.billId, model.inviteId] : null;
}
