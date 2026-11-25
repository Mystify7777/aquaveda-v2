import { Badge } from "@/components/ui/badge";
import { stateLabel, stateTone } from "@/lib/accounts/presentation";

/** State as visible text (never color alone). */
export function AccountStateBadge({ state }: { state: string }) {
  return <Badge variant={stateTone(state)}>{stateLabel(state)}</Badge>;
}
