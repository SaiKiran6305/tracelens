import { Router, type IRouter } from "express";
import healthRouter from "./health";
import traceLensRouter from "./tracelens";
import projectRouter from "./projects";
import collectorRouter from "./collector";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/projects", projectRouter);
router.use("/collector", collectorRouter);
router.use(traceLensRouter);

export default router;
