import { ScrollView } from 'react-native';
import { Text, VStack } from './primitives';
import { ScreenHeader } from './screen-header';

type Props = {
  eyebrow: string;
  title: string;
  note: string;
  onBack?: () => void;
};

/** Placeholder body for screens not built out yet — swap for the real UI screen by screen. */
export function ComingSoonScreen({ eyebrow, title, note, onBack }: Props) {
  return (
    <ScrollView className="flex-1 bg-bg-screen">
      <ScreenHeader eyebrow={eyebrow} title={title} onBack={onBack} />
      <VStack className="px-5 pt-4">
        <Text className="font-body text-muted">{note}</Text>
      </VStack>
    </ScrollView>
  );
}
