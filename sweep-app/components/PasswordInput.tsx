// components/PasswordInput.tsx
//
// A password field with a reveal toggle.
//
// Worth having as a component rather than a prop on each screen: passwords are
// typed on a phone keyboard where a mistyped character is invisible and the
// only feedback is a failure several seconds later. Being able to check what
// you typed is the difference between "wrong password" being informative and
// being a guessing game.
//
// The toggle is inside the field rather than beside it so it can't be mistaken
// for a submit button, which is what happens when it sits in the row below.

import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";

interface Props extends Omit<TextInputProps, "secureTextEntry"> {
  /** Merged over the field's own styling, for callers with layout needs. */
  fieldStyle?: TextInputProps["style"];
}

export default function PasswordInput({ fieldStyle, ...props }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.wrap}>
      <TextInput
        {...props}
        style={[styles.input, fieldStyle]}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={props.placeholderTextColor ?? colors.textTertiary}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={12}
        style={styles.toggle}
        // Announced rather than left as a bare icon: to a screen reader an
        // unlabelled eye is just "button".
        accessibilityRole="button"
        accessibilityLabel={visible ? "Hide password" : "Show password"}
      >
        <Ionicons
          name={visible ? "eye-off-outline" : "eye-outline"}
          size={19}
          color={colors.textSecondary}
        />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { position: "relative", justifyContent: "center" },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      // Room for the toggle, so a long password never runs underneath it.
      paddingRight: 48,
      paddingVertical: 13,
      color: colors.textPrimary,
      fontSize: type.body.fontSize,
    },
    toggle: {
      position: "absolute",
      right: 0,
      height: "100%",
      width: 46,
      alignItems: "center",
      justifyContent: "center",
    },
  });
