import { z } from 'zod';

/** Explicit source-backed tests avoid turning every report heading into a code change. */
export const sourceTestDefinitionSchema = z.object({
  testId:z.string().regex(/^source-test-\d+$/).max(60),
  label:z.string().trim().min(1).max(80),
  aliases:z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  result:z.string().trim().min(1).max(10000),
  sourceLocator:z.string().trim().min(1).max(300),
}).strict();
export const sourceTestDefinitionsSchema=z.array(sourceTestDefinitionSchema).max(128).superRefine((definitions,ctx)=>{
  const ids=new Set<string>();
  definitions.forEach((item,index)=>{if(ids.has(item.testId))ctx.addIssue({code:'custom',path:[index,'testId'],message:'检查ID不能重复'});ids.add(item.testId);});
});
export type SourceTestDefinition=z.infer<typeof sourceTestDefinitionSchema>;
