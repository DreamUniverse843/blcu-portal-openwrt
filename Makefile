include $(TOPDIR)/rules.mk

PKG_NAME:=blcu-portal
PKG_VERSION:=0.5.0
PKG_RELEASE:=5
PKG_LICENSE:=GPL-3.0-only
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/blcu-portal
  SECTION:=net
  CATEGORY:=Network
  TITLE:=BLCU Dr.COM campus portal client
  DEPENDS:=+python3 +curl +ca-bundle +ubus
  PKGARCH:=all
endef

define Package/luci-app-blcu-portal
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI for BLCU Dr.COM campus portal
  DEPENDS:=+luci-base +blcu-portal +rpcd
  PKGARCH:=all
endef

define Package/blcu-portal/conffiles
/etc/config/blcu-portal
endef

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) ./LICENSE $(PKG_BUILD_DIR)/
endef

define Build/Compile
endef

define Package/blcu-portal/install
	$(INSTALL_DIR) $(1)/usr/bin $(1)/etc/init.d $(1)/etc/config
	$(INSTALL_BIN) ./files/blcu-portal $(1)/usr/bin/blcu-portal
	$(INSTALL_BIN) ./files/blcu-portal.init $(1)/etc/init.d/blcu-portal
	$(INSTALL_CONF) ./files/blcu-portal.config $(1)/etc/config/blcu-portal
endef

define Package/luci-app-blcu-portal/install
	$(CP) ./luci/root/* $(1)/
	$(INSTALL_DIR) $(1)/www
	$(CP) ./luci/htdocs/* $(1)/www/
endef

$(eval $(call BuildPackage,blcu-portal))
$(eval $(call BuildPackage,luci-app-blcu-portal))
