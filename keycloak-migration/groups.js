export const prepareGroups = (groups) => {
  return groups.map((group) => {
    const name = handleDefaultGroupName(group.name);

    const {
      isAdministratorGroup,
      permissionLevelId,
      parentGroups,
      isSystem,
      description,
    } = group;

    const keycloackGroup = {
      id: group.id,
      name,
      path: `/${name.replace(/\s+/g, "-")}`, // Replace spaces with hyphens
      subGroups: [], // Initialize empty subGroups array
      realmRoles: [],
      attributes: {},
      clientRoles: {},
    };

    if (isSystem) {
      keycloackGroup.attributes.isSystem = ["true"];
      if (isAdministratorGroup) {
        keycloackGroup.attributes.isAdministratorGroup = ["true"];
      }
    }

    if (description) {
      keycloackGroup.attributes.description = description;
    }

    if (permissionLevelId && permissionLevelId !== "-1") {
      keycloackGroup.realmRoles.push(permissionLevelId);
    }

    return keycloackGroup;
  });
};

export const handleDefaultGroupName = (groupName) => {
  switch (groupName) {
    case "Administrators":
      return "administrators";
    case "Users":
      return "users";
    case "System-Admins":
      return "system-admins";
    case "Everyone":
      return "everyone";
    default:
      return groupName;
  }
};
