export const prepareGatewayDispatch = <TMeta, TParams>(
  trustedMeta: TMeta,
  params: TParams,
) => ({
  meta: trustedMeta,
  params,
});
