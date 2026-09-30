import {createFileRoute} from "@tanstack/react-router";
import {SkillDetailResponse} from "../../lib/api/customize";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

export const Route = createFileRoute("/api/customize/skills/$skillId")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {skillId: string}}) => {
				const {findIndexedSkill} = await import("../../lib/customize/indexed-skills");
				const {readSkillDetail} = await import("../../lib/customize/skills");
				const skill = await findIndexedSkill(params.skillId);
				if (skill === undefined) {
					return Response.json(
						{error: "Skill not found"},
						{status: 404, headers: {"Cache-Control": PRIVATE_NO_CACHE}},
					);
				}
				return Response.json(SkillDetailResponse.parse(await readSkillDetail(skill)), {
					headers: {"Cache-Control": PRIVATE_NO_CACHE},
				});
			},
		}),
	},
});
