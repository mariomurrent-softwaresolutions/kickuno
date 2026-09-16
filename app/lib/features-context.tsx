import { createContext, useContext, type PropsWithChildren } from 'react';

/** Mirrors `groups.features` — see documentation/implementation-plan.md §3.8/§4.6. */
export type GroupFeatures = {
  rsvp: boolean;
  autoBalance: boolean;
  strength: boolean;
  /** Off by default, unlike the other three — see `Groups.ts`'s `features.mvp` field. */
  mvp: boolean;
};

const DEFAULT_FEATURES: GroupFeatures = { rsvp: true, autoBalance: true, strength: true, mvp: false };

const FeaturesContext = createContext<GroupFeatures>(DEFAULT_FEATURES);

/**
 * TODO(cms): feed this from `GET /api/groups/:id`'s `features` object instead
 * of the all-on default, once group context is loaded after login.
 */
export function FeaturesProvider({
  children,
  value,
}: PropsWithChildren<{ value?: GroupFeatures }>) {
  return (
    <FeaturesContext.Provider value={value ?? DEFAULT_FEATURES}>
      {children}
    </FeaturesContext.Provider>
  );
}

export function useFeatures() {
  return useContext(FeaturesContext);
}
