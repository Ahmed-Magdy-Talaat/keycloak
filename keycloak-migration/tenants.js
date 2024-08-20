import axios from "axios";
import connectToMongoDB from "../connections/mongoDB.js";
import { buildGroupTree } from "../helper/createTenantHelper.js";
import fs from "fs";

const KEYCLOAK_URL = "http://192.168.0.180:8080";
const organizationId = "73288cd5-ceef-4eb1-921c-211d0beebaa3";

export const createTenant = async (accessToken) => {
  try {
    // Connect to MongoDB
    const client = await connectToMongoDB();

    // Fetch the latest Keycloak payload
    const KeycloakPayLoad = await client
      .db("core-authentication-dev")
      .collection("keycloak-tenant-payload")
      .find()
      .sort({ version: -1 })
      .limit(1)
      .toArray();

    if (KeycloakPayLoad.length === 0) {
      throw new Error("No Keycloak tenant payload found");
    }

    let tenantPayload = KeycloakPayLoad[0].data;

    // Fetch groups and build tree structure
    const groups = await client
      .db("core-authentication-docker")
      .collection("core-authentication-group")
      .find({ organizationId, isDeleted: false })
      .toArray();

    const keycloakGroups = buildGroupTree(groups);

    console.log(keycloakGroups);
    tenantPayload.groups = keycloakGroups;
    tenantPayload.realm = organizationId;
    tenantPayload.id = organizationId;
    tenantPayload.displayName = organizationId;

    // Write JSON file
    fs.writeFileSync(
      "./tenant.json",
      JSON.stringify(tenantPayload, null, 2),
      "utf8"
    );

    // Return or send the request to Keycloak
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const response = await axios.post(
      `${KEYCLOAK_URL}/admin/realms`,
      tenantPayload,
      { headers }
    );

    return response.data;
  } catch (error) {
    console.error("Error creating tenant:", {
      message: error.message,
      response: error.response
        ? {
            status: error.response.status,
            data: error.response.data,
            headers: error.response.headers,
          }
        : undefined,
    });
    throw error; // Re-throw the error for further handling
  }
};

import axios from "axios";
import { MongoClient } from "mongodb";
import getAccessToken from "../helper/getAccessToken.js";

const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "core-authentication-docker";
const GROUP_COLLECTION_NAME = "core-authentication-group";
const USER_COLLECTION_NAME = "core-authentication-user";
const KEYCLOAK_URL = "http://192.168.0.180:8080";

let groupMap = {};
let userIdMap = {};

async function fetchGroupsFromMongoDB() {
  const client = new MongoClient(MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const groups = await db
      .collection(GROUP_COLLECTION_NAME)
      .find({})
      .toArray();
    groups.forEach((group) => (groupMap[group.id] = group.name));
    return groups;
  } finally {
    await client.close();
  }
}

async function assignRole(token, entityId, roleName, isGroup) {
  const entityType = isGroup ? "groups" : "users";

  try {
    // Fetch the role ID using the role name
    const roleResponse = await axios.get(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/roles`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const role = roleResponse.data.find((r) => r.name === roleName);
    if (!role) {
      throw new Error(`Role ${roleName} not found`);
    }

    const roleId = role.id;

    // Assign the role to the entity (user or group)
    await axios.post(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/${entityType}/${entityId}/role-mappings/realm`,
      [
        {
          id: roleId,
          name: roleName,
        },
      ],
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      `Role ${roleName} assigned to ${entityType} ${entityId} successfully.`
    );
  } catch (error) {
    console.error(
      `Error assigning role to ${isGroup ? "group" : "user"}:`,
      error.response ? error.response.data : error.message
    );
  }
}

async function fetchUsersFromMongoDB() {
  const client = new MongoClient(MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    return await db
      .collection(USER_COLLECTION_NAME)
      .find({
        status: { $ne: "Deactivated" },
        organizationID: "73288cd5-ceef-4eb1-921c-211d0beebaa3",
      })
      .toArray();
  } finally {
    await client.close();
  }
}

async function isEmailInKeycloak(token, email) {
  try {
    const response = await axios.get(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        params: {
          email: email,
          max: 1,
        },
      }
    );
    return response.data.length > 0;
  } catch (error) {
    console.error(
      "Error checking email in Keycloak:",
      error.response ? error.response.data : error.message
    );
    return false;
  }
}

async function createUserInKeycloak(token, user) {
  try {
    const response = await axios.post(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users`,
      {
        username: user.email,
        email: user.email,
        enabled: true,
        credentials: [
          { type: "password", value: "contellect123", temporary: true },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    const createdUserResponse = await axios.get(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        params: {
          email: user.email,
        },
      }
    );
    const userId = createdUserResponse.data[0].id;
    userIdMap[user.email] = userId;
    return userId;
  } catch (error) {
    console.error(
      "Error creating user in Keycloak:",
      error.response ? error.response.data : error.message
    );
    return null;
  }
}

async function addUserToGroup(token, userId, groupId) {
  try {
    await axios.put(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}/groups/${groupId}`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "Error adding user to group:",
      error.response ? error.response.data : error.message
    );
  }
}

async function updateUsersAndRoles(token) {
  try {
    const groups = await fetchGroupsFromMongoDB();

    const users = await fetchUsersFromMongoDB();

    for (const user of users) {
      if (!(await isEmailInKeycloak(token, user.email))) {
        const userId = await createUserInKeycloak(token, user);
        if (userId) {
          const userGroups = user.groups || [];
          for (const groupId of userGroups) {
            if (groupId) {
              await addUserToGroup(token, userId, groupId);
            }
          }
        }
      }
    }

    await assignGroupsAndUsersRoles(token);
  } catch (error) {
    console.error(
      "Error importing users:",
      error.response ? error.response.data : error.message
    );
  }
}

async function assignGroupsAndUsersRoles(token) {
  const client = new MongoClient(MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const results = await db
      .collection("core-authentication-permission-level")
      .find({ organizationId: "73288cd5-ceef-4eb1-921c-211d0beebaa3" })
      .toArray();

    for (const doc of results) {
      await createRole(token, doc.id, doc.description);
    }

    for (const doc of results) {
      const assignedUsersAndGroups = doc.assignedUsersAndGroups || [];
      for (const item of assignedUsersAndGroups) {
        const entityId = item.isUser ? userIdMap[item.objectID] : item.objectID;
        if (entityId) {
          await assignRole(token, entityId, doc.id, !item.isUser);
        }
      }
    }
  } finally {
    await client.close();
  }
}

async function createRole(token, roleName, description) {
  try {
    await axios.post(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/roles`,
      {
        name: roleName,
        description: description,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "Error creating role in Keycloak:",
      error.response ? error.response.data : error.message
    );
  }
}

async function triggerPasswordReset(token, userId) {
  try {
    await axios.put(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}/execute-actions-email`,
      ["UPDATE_PASSWORD"],
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`Password reset email sent to user ${userId}.`);
  } catch (error) {
    console.error(
      "Error triggering password reset email:",
      error.response ? error.response.data : error.message
    );
  }
}

export default updateUsersAndRoles;
