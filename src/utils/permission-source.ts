import { SOURCE_LABELS } from '@/types/agent'

/** Human label for the agent that raised a permission request. */
export function permissionSourceName(agentId: string): string {
  return SOURCE_LABELS[agentId as keyof typeof SOURCE_LABELS] ?? agentId
}
