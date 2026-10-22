!macro customUnInstall
  ${ifNot} ${isUpdated}
    StrCpy $0 "1"

    ${GetParameters} $R0
    ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
    ${IfNot} ${Errors}
      StrCpy $0 "0"
    ${Else}
      ${IfNot} ${Silent}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "ユーザーデータ（ライブラリ設定、閲覧履歴、サムネイルなど）も削除しますか?$\r$\n$\r$\n「はい」を選ぶと削除されます。削除後は設定がリセットされ、再インストール時に初期設定が必要です。この操作は取り消せません。" IDYES kurarium_delete_user_data
        StrCpy $0 "0"
        Goto kurarium_user_data_done

        kurarium_delete_user_data:
          StrCpy $0 "1"
      ${EndIf}
    ${EndIf}

    kurarium_user_data_done:
    ${if} $0 == "1"
      RMDir /r "$LOCALAPPDATA\Kurarium"
    ${endif}
  ${endIf}
!macroend
