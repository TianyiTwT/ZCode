import { useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { LocalProfileAvatarCropDialog } from "@/settings/LocalProfileAvatarCropDialog.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  getLocalProfileAvatarFallbackText,
  MAX_LOCAL_PROFILE_NAME_LENGTH,
  type LocalProfileSettings,
} from "@/lib/localProfile.js";

/**
 * 外观设置里的「个人资料」分区。
 *
 * 这里配置的是侧边栏底部展示的名称与头像，全部保存在本机，
 * 因此组件不读取也不写入任何登录态，改完立刻生效。
 * 选图后的裁剪、压缩、编码都交给 LocalProfileAvatarCropDialog，
 * 本组件只负责收集文件、把结果写回偏好、以及展示当前头像。
 */
export function LocalProfileSection({
  localProfile,
  setLocalProfile,
}: {
  localProfile: LocalProfileSettings;
  setLocalProfile: (patch: Partial<LocalProfileSettings>) => void;
}) {
  const { intl } = useZCodeIntl();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  // 选中的文件先挂在本地，确认裁剪后才写进偏好，取消时丢弃。
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
  const avatarFallbackText = getLocalProfileAvatarFallbackText(localProfile.name);

  const handleAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    // 连续选择同一个文件不会再触发 change，必须先把 input 的值清空。
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    setPendingAvatarFile(file);
    setIsCropDialogOpen(true);
  };

  const handleCropDialogOpenChange = (nextOpen: boolean) => {
    setIsCropDialogOpen(nextOpen);
    if (!nextOpen) {
      setPendingAvatarFile(null);
    }
  };

  const handleAvatarCropConfirm = (avatarDataUrl: string) => {
    setLocalProfile({ avatarDataUrl });
    setIsCropDialogOpen(false);
    setPendingAvatarFile(null);
  };

  return (
    <div className="min-w-0 space-y-3">
      <div>
        <h3 className="text-ui-lg font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.appearance.profileTitle" })}
        </h3>
        <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
          {intl.formatMessage({ id: "settings.appearance.profileDescription" })}
        </p>
      </div>
      <Card className="border border-border bg-card py-0 shadow-none">
        <CardContent className="space-y-0 px-0">
          <SettingsRow
            label={intl.formatMessage({ id: "settings.localProfile.showInSidebar" })}
            description={intl.formatMessage({
              id: "settings.localProfile.showInSidebarDescription",
            })}
            control={
              <Switch
                checked={localProfile.showInSidebar}
                onCheckedChange={(checked) => setLocalProfile({ showInSidebar: checked })}
              />
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.localProfile.name" })}
            description={intl.formatMessage({
              id: "settings.localProfile.nameDescription",
            })}
            control={
              <Input
                size="lg"
                className="w-[260px] min-w-0"
                value={localProfile.name}
                maxLength={MAX_LOCAL_PROFILE_NAME_LENGTH}
                placeholder={intl.formatMessage({
                  id: "settings.localProfile.namePlaceholder",
                })}
                aria-label={intl.formatMessage({ id: "settings.localProfile.name" })}
                onChange={(event) => setLocalProfile({ name: event.currentTarget.value })}
              />
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.localProfile.avatar" })}
            description={intl.formatMessage({
              id: "settings.localProfile.avatarDescription",
            })}
            control={
              <Avatar size="lg">
                {localProfile.avatarDataUrl ? (
                  <AvatarImage
                    src={localProfile.avatarDataUrl}
                    alt={intl.formatMessage({ id: "settings.localProfile.avatar" })}
                  />
                ) : null}
                <AvatarFallback className="bg-background text-foreground">
                  {avatarFallbackText}
                </AvatarFallback>
              </Avatar>
            }
            detail={
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={handleAvatarFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  <ImagePlus className="size-4" />
                  {intl.formatMessage({ id: "settings.localProfile.avatarChoose" })}
                </Button>
                {localProfile.avatarDataUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    onClick={() => setLocalProfile({ avatarDataUrl: null })}
                  >
                    <Trash2 className="size-4" />
                    {intl.formatMessage({ id: "settings.localProfile.avatarRemove" })}
                  </Button>
                ) : null}
              </div>
            }
          />
        </CardContent>
      </Card>
      <LocalProfileAvatarCropDialog
        open={isCropDialogOpen}
        file={pendingAvatarFile}
        onOpenChange={handleCropDialogOpenChange}
        onConfirm={handleAvatarCropConfirm}
      />
    </div>
  );
}
