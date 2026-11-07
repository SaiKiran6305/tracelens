import type { Run, TraceEvent } from "@workspace/api-client-react";
import { projectJourney, type JourneyStep } from "@/lib/journey";
import type { ExpectedStep, RealRunStatus } from "@/lib/project-api";

/**
 * Real-project projection. projectJourney accepts optional expectedSteps as its third parameter;
 * the run status set for real runs also includes unknown/incomplete, which the projection treats truthfully.
 */
type Projector = (events: TraceEvent[], run: Pick<Run, "variant" | "status">, expectedSteps?: ExpectedStep[]) => JourneyStep[];
export function projectRealJourney(events: TraceEvent[], status: RealRunStatus, expected: ExpectedStep[]): JourneyStep[] {
  return (projectJourney as Projector)(events, { variant: "external", status: status as Run["status"] }, expected);
}
