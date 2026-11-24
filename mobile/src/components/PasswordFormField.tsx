import React,{useState} from 'react';
import {Pressable} from 'react-native';
import {useTranslation} from 'react-i18next';
import type {FieldValues} from 'react-hook-form';
import {FormField} from './FormField';
import {Text} from './Text';

export function PasswordFormField<T extends FieldValues>(props:Parameters<typeof FormField<T>>[0]){
 const [visible,setVisible]=useState(false);
 const {t}=useTranslation();
 return <FormField {...props} secureTextEntry={!visible} right={<Pressable accessibilityRole="button" accessibilityLabel={t('auth.togglePassword')} accessibilityState={{selected:visible}} onPress={()=>setVisible(value=>!value)} style={{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'}}><Text color="textMuted">{'\u{1f441}'}</Text></Pressable>}/>;
}
